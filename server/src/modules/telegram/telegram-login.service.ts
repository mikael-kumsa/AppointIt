import crypto from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { prisma } from "../../db.js";
import { env } from "../../config/env.js";
import { decryptSecret, encryptSecret } from "../../utils/crypto.js";

const telegramIssuer = "https://oauth.telegram.org";
const telegramAuthUrl = "https://oauth.telegram.org/auth";
const telegramTokenUrl = "https://oauth.telegram.org/token";
const telegramJwks = createRemoteJWKSet(new URL("https://oauth.telegram.org/.well-known/jwks.json"));

function base64Url(value: Buffer) {
  return value.toString("base64url");
}

function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest();
}

function hashForStorage(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function configured() {
  return Boolean(env.TELEGRAM_CLIENT_ID && env.TELEGRAM_CLIENT_SECRET && env.TELEGRAM_REDIRECT_URI);
}

export function normalizePhone(value?: string | null) {
  if (!value) return "";
  let digits = value.replace(/\D/g, "");
  while (digits.startsWith("00")) digits = digits.slice(2);
  return digits;
}

export async function startTelegramLogin(vendorId: string, userId?: string | null) {
  if (!configured()) {
    return {
      ok: false as const,
      error: "Telegram Login is not configured. Add TELEGRAM_CLIENT_ID and TELEGRAM_CLIENT_SECRET to .env."
    };
  }

  const state = base64Url(crypto.randomBytes(32));
  const nonce = base64Url(crypto.randomBytes(32));
  const codeVerifier = base64Url(crypto.randomBytes(64));
  const codeChallenge = base64Url(sha256(codeVerifier));

  await prisma.telegramVerificationSession.create({
    data: {
      vendorId,
      userId: userId ?? undefined,
      stateHash: hashForStorage(state),
      nonceHash: hashForStorage(nonce),
      encryptedCodeVerifier: encryptSecret(codeVerifier),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000)
    }
  });

  const params = new URLSearchParams({
    client_id: env.TELEGRAM_CLIENT_ID!,
    redirect_uri: env.TELEGRAM_REDIRECT_URI,
    response_type: "code",
    scope: "openid profile phone",
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256"
  });

  return { ok: true as const, url: `${telegramAuthUrl}?${params.toString()}` };
}

async function exchangeCodeForIdToken(code: string, codeVerifier: string) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: env.TELEGRAM_REDIRECT_URI,
    client_id: env.TELEGRAM_CLIENT_ID!,
    code_verifier: codeVerifier
  });
  const credentials = Buffer.from(`${env.TELEGRAM_CLIENT_ID}:${env.TELEGRAM_CLIENT_SECRET}`).toString("base64");
  const response = await fetch(telegramTokenUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${credentials}`
    },
    body
  });
  const payload = await response.json() as { id_token?: string; error?: string; error_description?: string };
  if (!response.ok || !payload.id_token) {
    throw new Error(payload.error_description || payload.error || "Telegram token exchange failed");
  }
  return payload.id_token;
}

export async function completeTelegramLogin(code: string, state: string) {
  if (!configured()) throw new Error("Telegram Login is not configured");

  const session = await prisma.telegramVerificationSession.findUnique({
    where: { stateHash: hashForStorage(state) },
    include: { vendor: true }
  });
  if (!session || session.usedAt || session.expiresAt < new Date()) {
    throw new Error("Telegram verification link expired. Please try again.");
  }

  const codeVerifier = decryptSecret(session.encryptedCodeVerifier);
  const idToken = await exchangeCodeForIdToken(code, codeVerifier);
  const verified = await jwtVerify(idToken, telegramJwks, {
    issuer: telegramIssuer,
    audience: env.TELEGRAM_CLIENT_ID
  });

  const claims = verified.payload as {
    sub?: string;
    id?: number;
    name?: string;
    preferred_username?: string;
    phone_number?: string;
    nonce?: string;
  };

  if (hashForStorage(String(claims.nonce ?? "")) !== session.nonceHash) {
    throw new Error("Telegram verification nonce mismatch");
  }

  const targetUser = session.userId
    ? await prisma.user.findUnique({ where: { id: session.userId } })
    : await prisma.user.findFirst({
        where: { vendorId: session.vendorId, role: "VENDOR_ADMIN" },
        orderBy: { createdAt: "asc" }
      });

  const telegramPhone = normalizePhone(claims.phone_number);
  const targetPhone = normalizePhone(targetUser?.phone ?? session.vendor.phone);
  if (!telegramPhone) throw new Error("Telegram did not return a phone number. Please approve phone sharing.");
  if (targetPhone && telegramPhone !== targetPhone) {
    throw new Error("Telegram phone number does not match the phone number on file.");
  }

  const vendor = await prisma.$transaction(async (tx) => {
    const verifiedAt = new Date();
    await tx.telegramVerificationSession.update({
      where: { id: session.id },
      data: { usedAt: verifiedAt }
    });
    const updated = await tx.vendor.update({
      where: { id: session.vendorId },
      data: {
        phone: session.vendor.phone ?? claims.phone_number,
        phoneVerifiedAt: verifiedAt,
        telegramVerifiedAt: verifiedAt,
        telegramUserId: String(claims.id ?? claims.sub ?? ""),
        telegramUsername: claims.preferred_username,
        telegramName: claims.name,
        status: session.vendor.status === "PENDING_REVIEW" ? "ACTIVE" : session.vendor.status
      }
    });
    if (targetUser) {
      await tx.user.update({
        where: { id: targetUser.id },
        data: {
          phone: targetUser.phone ?? claims.phone_number,
          phoneVerifiedAt: verifiedAt,
          telegramVerifiedAt: verifiedAt,
          telegramUserId: String(claims.id ?? claims.sub ?? ""),
          telegramUsername: claims.preferred_username,
          telegramName: claims.name,
          active: true
        }
      });
    }
    await tx.auditLog.create({
      data: {
        vendorId: session.vendorId,
        actorUserId: targetUser?.id,
        action: "vendor_phone_verified_with_telegram",
        entityType: "Vendor",
        entityId: session.vendorId,
        metadata: {
          telegramUserId: String(claims.id ?? claims.sub ?? ""),
          telegramUsername: claims.preferred_username,
          userId: targetUser?.id,
          autoActivatedVendor: session.vendor.status === "PENDING_REVIEW"
        }
      }
    });
    return updated;
  });

  return {
    vendor,
    userEmail: targetUser?.email,
    requiresLogin: Boolean(session.userId)
  };
}
