import crypto from "node:crypto";
import { PhoneChallengePurpose, UserRole, VendorStatus } from "@prisma/client";
import { prisma } from "../../db.js";
import { env } from "../../config/env.js";
import { maskPhone, normalizePhone } from "../../utils/phone.js";
import { sendAfroMessageChallenge, verifyAfroMessageChallenge } from "../notifications/afromessage.service.js";

const RESEND_DELAY_MS = 60_000;
const MAX_ATTEMPTS = 5;
const DELIVERY_ERROR_MESSAGE = "We could not send a verification code. Please try again later or contact support.";

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function randomToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function logDeliveryFailure(userId: string, error: unknown) {
  const detail = error instanceof Error ? error.message : "Unknown AfroMessage error";
  console.error("AfroMessage verification delivery failed", {
    userId,
    detail: detail.replace(/\+?\d[\d\s()-]{7,}\d/g, "[phone]")
  });
}

export class PhoneVerificationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 409,
    public readonly retryAfterSeconds?: number
  ) {
    super(message);
  }
}

export async function startPhoneVerification(
  userId: string,
  purpose: PhoneChallengePurpose = PhoneChallengePurpose.PHONE_VERIFICATION
) {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { vendor: true } });
  if (!user || !user.active) throw new PhoneVerificationError("ACCOUNT_INACTIVE", "This account is inactive", 403);
  if (purpose === PhoneChallengePurpose.LOGIN_2FA && (!user.phoneVerifiedAt || !user.smsTwoFactorEnabled)) {
    throw new PhoneVerificationError("TWO_FACTOR_NOT_ENABLED", "SMS two-factor authentication is not enabled", 409);
  }
  const phone = normalizePhone(user.phone ?? user.vendor?.phone);
  if (!phone) {
    throw new PhoneVerificationError("PHONE_NUMBER_REQUIRED", "Add a valid phone number before verification", 409);
  }

  let challenge;
  try {
    challenge = await sendAfroMessageChallenge(phone);
  } catch (error) {
    logDeliveryFailure(userId, error);
    throw new PhoneVerificationError("OTP_DELIVERY_FAILED", DELIVERY_ERROR_MESSAGE, 503);
  }

  const token = randomToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + env.AFROMESSAGE_OTP_TTL_SECONDS * 1000);
  const resendAvailableAt = new Date(now.getTime() + RESEND_DELAY_MS);
  await prisma.$transaction(async (tx) => {
    await tx.phoneVerificationSession.updateMany({
      where: { userId, verifiedAt: null, expiresAt: { gt: now } },
      data: { expiresAt: now }
    });
    await tx.phoneVerificationSession.create({
      data: {
        userId,
        vendorId: user.vendorId,
        tokenHash: hashToken(token),
        providerVerificationId: challenge.verificationId!,
        phone,
        purpose,
        expiresAt,
        resendAvailableAt
      }
    });
  });

  return { challengeToken: token, phone: maskPhone(phone), expiresAt, resendAvailableAt };
}

export async function resendPhoneVerification(challengeToken: string) {
  const session = await prisma.phoneVerificationSession.findUnique({ where: { tokenHash: hashToken(challengeToken) } });
  if (!session || session.verifiedAt || session.expiresAt < new Date()) {
    throw new PhoneVerificationError("CHALLENGE_EXPIRED", "Verification session expired. Sign in again.");
  }
  const waitMs = session.resendAvailableAt.getTime() - Date.now();
  if (waitMs > 0) {
    throw new PhoneVerificationError("RESEND_TOO_SOON", "Please wait before requesting another code", 429, Math.ceil(waitMs / 1000));
  }

  let challenge;
  try {
    challenge = await sendAfroMessageChallenge(session.phone);
  } catch (error) {
    logDeliveryFailure(session.userId, error);
    throw new PhoneVerificationError("OTP_DELIVERY_FAILED", DELIVERY_ERROR_MESSAGE, 503);
  }
  const now = new Date();
  const expiresAt = new Date(now.getTime() + env.AFROMESSAGE_OTP_TTL_SECONDS * 1000);
  const resendAvailableAt = new Date(now.getTime() + RESEND_DELAY_MS);
  await prisma.phoneVerificationSession.update({
    where: { id: session.id },
    data: {
      providerVerificationId: challenge.verificationId!,
      expiresAt,
      resendAvailableAt,
      attempts: 0,
      sendCount: { increment: 1 }
    }
  });
  return { phone: maskPhone(session.phone), expiresAt, resendAvailableAt };
}

export async function completePhoneVerification(challengeToken: string, code: string) {
  const session = await prisma.phoneVerificationSession.findUnique({
    where: { tokenHash: hashToken(challengeToken) },
    include: { user: true, vendor: true }
  });
  if (!session || session.verifiedAt || session.expiresAt < new Date()) {
    throw new PhoneVerificationError("CHALLENGE_EXPIRED", "Verification session expired. Sign in again.");
  }
  if (session.attempts >= MAX_ATTEMPTS) {
    throw new PhoneVerificationError("TOO_MANY_ATTEMPTS", "Too many incorrect attempts. Sign in to request a new code.", 429);
  }

  await prisma.phoneVerificationSession.update({ where: { id: session.id }, data: { attempts: { increment: 1 } } });
  try {
    await verifyAfroMessageChallenge(session.providerVerificationId, code);
  } catch {
    throw new PhoneVerificationError("INVALID_CODE", "Verification code is invalid or expired");
  }

  const verifiedAt = new Date();
  const purpose = session.purpose ?? PhoneChallengePurpose.PHONE_VERIFICATION;
  if (purpose === PhoneChallengePurpose.LOGIN_2FA && (!session.user.phoneVerifiedAt || !session.user.smsTwoFactorEnabled)) {
    throw new PhoneVerificationError("TWO_FACTOR_NOT_ENABLED", "SMS two-factor authentication is not enabled", 409);
  }
  await prisma.$transaction(async (tx) => {
    await tx.phoneVerificationSession.update({ where: { id: session.id }, data: { verifiedAt } });
    if (purpose === PhoneChallengePurpose.PHONE_VERIFICATION) {
      await tx.user.update({ where: { id: session.userId }, data: { phoneVerifiedAt: verifiedAt, phone: session.phone } });
      if (session.vendorId && session.user.role === UserRole.VENDOR_ADMIN) {
        await tx.vendor.update({
          where: { id: session.vendorId },
          data: {
            phone: session.phone,
            phoneVerifiedAt: verifiedAt,
            ...(session.vendor?.status === VendorStatus.PENDING_REVIEW ? { status: VendorStatus.ACTIVE } : {})
          }
        });
      }
    }
    await tx.auditLog.create({
      data: {
        vendorId: session.vendorId,
        actorUserId: session.userId,
        action: purpose === PhoneChallengePurpose.LOGIN_2FA ? "sms_two_factor_login_completed" : "phone_verified_with_afromessage",
        entityType: "User",
        entityId: session.userId,
        metadata: { provider: "afromessage", sessionId: session.id, purpose }
      }
    });
  });
  return { userId: session.userId, verifiedAt, purpose };
}
