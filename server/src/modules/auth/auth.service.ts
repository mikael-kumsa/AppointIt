import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { SubscriptionStatus, UserRole, VendorStatus } from "@prisma/client";
import { prisma } from "../../db.js";
import { env } from "../../config/env.js";
import { maskPhone } from "../../utils/phone.js";
import { sendPlatformEmail } from "../notifications/email.service.js";

export type AuthUser = {
  id: string;
  vendorId: string | null;
  staffId?: string | null;
  role: UserRole;
  name: string;
  email: string;
  vendorStatus?: VendorStatus | null;
};

export async function verifyPassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash);
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function randomToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;"
  })[character]!);
}

function passwordResetHtml(name: string, resetUrl: string) {
  const safeName = escapeHtml(name);
  const safeUrl = escapeHtml(resetUrl);
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f3f7fb;color:#172033;font-family:Arial,sans-serif">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f7fb;padding:32px 16px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #dce5ef;border-radius:8px">
          <tr><td style="padding:32px">
            <p style="margin:0 0 24px;color:#2457a7;font-size:20px;font-weight:700">AppointIt</p>
            <h1 style="margin:0 0 16px;font-size:26px;line-height:1.25">Reset your password</h1>
            <p style="margin:0 0 16px;line-height:1.6">Hello ${safeName},</p>
            <p style="margin:0 0 24px;line-height:1.6">We received a request to reset your AppointIt password. Use the button below within 15 minutes.</p>
            <p style="margin:0 0 24px"><a href="${safeUrl}" style="display:inline-block;background:#2457a7;color:#ffffff;text-decoration:none;font-weight:700;padding:13px 20px;border-radius:6px">Reset password</a></p>
            <p style="margin:0 0 8px;color:#526277;font-size:13px;line-height:1.5">If the button does not work, copy this link into your browser:</p>
            <p style="margin:0 0 24px;word-break:break-all;font-size:13px;line-height:1.5"><a href="${safeUrl}" style="color:#2457a7">${safeUrl}</a></p>
            <p style="margin:0;color:#526277;font-size:13px;line-height:1.5">If you did not request this reset, you can safely ignore this email.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export function signAccessToken(user: AuthUser) {
  return jwt.sign(user, env.JWT_ACCESS_SECRET, { expiresIn: "15m" });
}

export function signRefreshToken(user: AuthUser) {
  return jwt.sign({ id: user.id }, env.JWT_REFRESH_SECRET, { expiresIn: "30d" });
}

export function signRenewalToken(userId: string, vendorId: string) {
  return jwt.sign({ scope: "subscription_renewal", userId, vendorId }, env.JWT_ACCESS_SECRET, { expiresIn: "30m" });
}

export function verifyRenewalToken(token: string) {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as { scope?: string; userId?: string; vendorId?: string };
  if (payload.scope !== "subscription_renewal" || !payload.userId || !payload.vendorId) throw new Error("Invalid renewal token");
  return { userId: payload.userId, vendorId: payload.vendorId };
}

async function buildAuthUser(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { vendor: { include: { subscription: true } } } });
  if (!user || !user.active) return null;
  if (requiresPhoneVerification(user) && !user.phoneVerifiedAt) return null;
  if (requiresPaidSubscription(user) && user.vendor?.subscription?.status !== SubscriptionStatus.ACTIVE) return null;
  const authUser: AuthUser = {
    id: user.id,
    vendorId: user.vendorId,
    staffId: user.staffId,
    role: user.role,
    name: user.name,
    email: user.email,
    vendorStatus: user.vendor?.status ?? null
  };
  return authUser;
}

function requiresPhoneVerification(user: { vendorId: string | null; role: UserRole }) {
  return Boolean(user.vendorId && user.role !== UserRole.CUSTOMER);
}

function requiresPaidSubscription(user: { vendorId: string | null; role: UserRole }) {
  return Boolean(user.vendorId && user.role !== UserRole.CUSTOMER);
}

async function createRefreshToken(userId: string) {
  const token = randomToken();
  await prisma.authRefreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    }
  });
  return token;
}

export async function login(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email }, include: { vendor: { include: { subscription: true } } } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return { ok: false as const, reason: "INVALID_CREDENTIALS" };
  }

  if (!user.active) {
    return {
      ok: false as const,
      reason: user.vendor?.status === VendorStatus.PENDING_REVIEW ? "PENDING_REVIEW" : "ACCOUNT_INACTIVE",
      vendorStatus: user.vendor?.status ?? null
    };
  }

  if (requiresPhoneVerification(user) && !user.phoneVerifiedAt) {
    return {
      ok: false as const,
      reason: "PHONE_VERIFICATION_REQUIRED",
      vendorStatus: user.vendor?.status ?? null,
      userId: user.id
    };
  }

  if (user.vendor?.status === VendorStatus.PENDING_REVIEW) {
    return {
      ok: false as const,
      reason: "PENDING_REVIEW",
      vendorStatus: user.vendor.status
    };
  }

  if (requiresPaidSubscription(user) && user.vendor?.subscription?.status !== SubscriptionStatus.ACTIVE) {
    return {
      ok: false as const,
      reason: "SUBSCRIPTION_REQUIRED",
      vendorStatus: user.vendor?.status ?? null,
      renewalToken: user.role === UserRole.VENDOR_ADMIN && user.vendorId ? signRenewalToken(user.id, user.vendorId) : undefined
    };
  }

  if (user.smsTwoFactorEnabled) {
    return {
      ok: false as const,
      reason: "TWO_FACTOR_REQUIRED",
      vendorStatus: user.vendor?.status ?? null,
      userId: user.id
    };
  }

  const session = await createAuthenticatedSession(user.id);
  return session ?? { ok: false as const, reason: "ACCOUNT_INACTIVE", vendorStatus: user.vendor?.status ?? null };
}

export async function getSecuritySettings(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.active) return null;
  return {
    phone: user.phone ? maskPhone(user.phone) : null,
    phoneVerifiedAt: user.phoneVerifiedAt,
    smsTwoFactorEnabled: user.smsTwoFactorEnabled
  };
}

export async function updateSmsTwoFactor(userId: string, enabled: boolean, currentPassword: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.active) throw new Error("Account is not available.");
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new Error("Current password is incorrect.");
  }
  if (enabled && (!user.phone || !user.phoneVerifiedAt)) {
    throw new Error("Verify your phone number before enabling SMS two-factor authentication.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { smsTwoFactorEnabled: enabled } });
    await tx.authRefreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.auditLog.create({
      data: {
        vendorId: user.vendorId,
        actorUserId: userId,
        action: enabled ? "sms_two_factor_enabled" : "sms_two_factor_disabled",
        entityType: "User",
        entityId: userId
      }
    });
  });

  return {
    phone: user.phone ? maskPhone(user.phone) : null,
    phoneVerifiedAt: user.phoneVerifiedAt,
    smsTwoFactorEnabled: enabled
  };
}

export async function createAuthenticatedSession(userId: string) {
  const authUser = await buildAuthUser(userId);
  if (!authUser) return null;
  await prisma.auditLog.create({
    data: {
      vendorId: authUser.vendorId,
      actorUserId: authUser.id,
      action: "user_login",
      entityType: "User",
      entityId: authUser.id
    }
  });

  return {
    ok: true as const,
    user: authUser,
    accessToken: signAccessToken(authUser),
    refreshToken: await createRefreshToken(authUser.id)
  };
}

export async function refreshSession(refreshToken: string) {
  const stored = await prisma.authRefreshToken.findUnique({
    where: { tokenHash: hashToken(refreshToken) },
    include: { user: { include: { vendor: true } } }
  });
  if (!stored || stored.revokedAt || stored.expiresAt < new Date() || !stored.user.active) return null;
  if (requiresPhoneVerification(stored.user) && !stored.user.phoneVerifiedAt) return null;
  await prisma.authRefreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
  const authUser = await buildAuthUser(stored.userId);
  if (!authUser) return null;
  return {
    ok: true as const,
    user: authUser,
    accessToken: signAccessToken(authUser),
    refreshToken: await createRefreshToken(stored.userId)
  };
}

export async function logout(refreshToken: string, actorUserId?: string) {
  const stored = await prisma.authRefreshToken.findUnique({ where: { tokenHash: hashToken(refreshToken) } });
  if (!stored) return;
  await prisma.authRefreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
  await prisma.auditLog.create({
    data: {
      actorUserId: actorUserId ?? stored.userId,
      action: "user_logout",
      entityType: "User",
      entityId: actorUserId ?? stored.userId
    }
  });
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new Error("Current password is incorrect.");
  }
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(newPassword) } });
    await tx.authRefreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.auditLog.create({
      data: {
        vendorId: user.vendorId,
        actorUserId: userId,
        action: "password_changed",
        entityType: "User",
        entityId: userId
      }
    });
  });
}

export async function requestPasswordReset(email: string) {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user || !user.active) return { created: false as const };
  const token = randomToken();
  const resetUrl = new URL("/reset-password", env.PASSWORD_RESET_ORIGIN ?? env.APP_ORIGIN);
  resetUrl.searchParams.set("token", token);
  const resetUrlString = resetUrl.toString();
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() }
  });
  const reset = await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000)
    }
  });
  await prisma.auditLog.create({
    data: {
      vendorId: user.vendorId,
      actorUserId: user.id,
      action: "password_reset_requested",
      entityType: "User",
      entityId: user.id,
      metadata: { resetTokenId: reset.id }
    }
  });
  try {
    const delivery = await sendPlatformEmail({
      to: user.email,
      subject: "Reset your AppointIt password",
      text: [
        `Hello ${user.name ?? "there"},`,
        "",
        "We received a request to reset your AppointIt password.",
        resetUrlString,
        "",
        "This link expires in 15 minutes and can only be used once.",
        "If you did not request this reset, you can ignore this email."
      ].join("\n"),
      html: passwordResetHtml(user.name ?? "there", resetUrlString)
    });
    await prisma.auditLog.create({
      data: {
        vendorId: user.vendorId,
        actorUserId: user.id,
        action: "password_reset_email_sent",
        entityType: "User",
        entityId: user.id,
        metadata: {
          resetTokenId: reset.id,
          providerMessageId: delivery.messageId,
          accepted: delivery.accepted,
          rejected: delivery.rejected,
          smtpResponse: delivery.response
        }
      }
    });
    return { created: true as const, delivered: true as const };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Email delivery failed";
    await prisma.auditLog.create({
      data: {
        vendorId: user.vendorId,
        actorUserId: user.id,
        action: "password_reset_email_failed",
        entityType: "User",
        entityId: user.id,
        metadata: { resetTokenId: reset.id, error: errorMessage }
      }
    });
    console.error("Password reset email delivery failed", { userId: user.id, error: errorMessage });
    return { created: true as const, delivered: false as const };
  }
}

export async function resetPassword(token: string, password: string) {
  const stored = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true }
  });
  if (!stored || stored.usedAt || stored.expiresAt < new Date() || !stored.user.active) {
    throw new Error("Password reset link is invalid or expired.");
  }
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: stored.userId }, data: { passwordHash: await hashPassword(password) } });
    await tx.passwordResetToken.update({ where: { id: stored.id }, data: { usedAt: new Date() } });
    await tx.authRefreshToken.updateMany({ where: { userId: stored.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.auditLog.create({
      data: {
        vendorId: stored.user.vendorId,
        actorUserId: stored.userId,
        action: "password_reset_completed",
        entityType: "User",
        entityId: stored.userId
      }
    });
  });
}

export async function getAuthContext(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { vendor: { include: { subscription: true } } }
  });
  if (!user || !user.active) return null;
  if (requiresPaidSubscription(user) && user.vendor?.subscription?.status !== SubscriptionStatus.ACTIVE) return null;
  return {
    id: user.id,
    vendorId: user.vendorId,
    staffId: user.staffId,
    role: user.role,
    name: user.name,
    email: user.email,
    vendorStatus: user.vendor?.status ?? null,
    vendor: user.vendor
      ? {
          id: user.vendor.id,
          name: user.vendor.name,
          slug: user.vendor.slug,
          status: user.vendor.status,
          subscriptionStatus: user.vendor.subscription?.status ?? null
        }
      : null
  };
}
