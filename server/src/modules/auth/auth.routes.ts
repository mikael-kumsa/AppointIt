import { Router } from "express";
import rateLimit from "express-rate-limit";
import { PhoneChallengePurpose } from "@prisma/client";
import { z } from "zod";
import { changePassword, createAuthenticatedSession, getAuthContext, getSecuritySettings, login, logout, refreshSession, requestPasswordReset, resetPassword, updateSmsTwoFactor } from "./auth.service.js";
import { validateBody } from "../../middleware/validate.js";
import { requireAuth } from "../../middleware/auth.js";
import { acceptStaffInvite } from "../staff/staff-invites.service.js";
import { completePhoneVerification, PhoneVerificationError, resendPhoneVerification, startPhoneVerification } from "./phone-verification.service.js";

export const authRouter = Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });
const otpLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });
const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many password reset requests. Please wait 15 minutes before trying again." }
});

authRouter.post(
  "/login",
  loginLimiter,
  validateBody(z.object({ email: z.string().email(), password: z.string().min(8) })),
  async (req, res) => {
    const result = await login(req.body.email, req.body.password);
    if (!result.ok) {
      const status = result.reason === "INVALID_CREDENTIALS" ? 401 : 403;
      const message = result.reason === "PENDING_REVIEW"
        ? "Your business account is pending phone verification or activation"
        : result.reason === "PHONE_VERIFICATION_REQUIRED"
          ? "Please verify your phone number before signing in"
        : result.reason === "TWO_FACTOR_REQUIRED"
          ? "Enter the security code sent to your phone"
        : result.reason === "SUBSCRIPTION_REQUIRED"
          ? "Your paid subscription is pending activation"
        : result.reason === "ACCOUNT_INACTIVE"
          ? "This account is inactive"
          : "Invalid credentials";
      if (result.reason === "PHONE_VERIFICATION_REQUIRED" || result.reason === "TWO_FACTOR_REQUIRED") {
        if (!("userId" in result) || !result.userId) {
          return res.status(503).json({ error: "Could not start phone verification", reason: "OTP_DELIVERY_FAILED" });
        }
        try {
          const purpose = result.reason === "TWO_FACTOR_REQUIRED"
            ? PhoneChallengePurpose.LOGIN_2FA
            : PhoneChallengePurpose.PHONE_VERIFICATION;
          const challenge = await startPhoneVerification(result.userId, purpose);
          return res.status(403).json({
            error: message,
            reason: result.reason,
            vendorStatus: result.vendorStatus,
            ...challenge
          });
        } catch (error) {
          const verificationError = error instanceof PhoneVerificationError ? error : null;
          return res.status(verificationError?.status ?? 503).json({
            error: verificationError?.message ?? "Could not send verification code",
            reason: verificationError?.code ?? "OTP_DELIVERY_FAILED",
            vendorStatus: result.vendorStatus
          });
        }
      }
      return res.status(status).json({
        error: message,
        reason: result.reason,
        vendorStatus: result.vendorStatus,
        ...("renewalToken" in result ? { renewalToken: result.renewalToken } : {})
      });
    }
    return res.json(result);
  }
);

authRouter.post(
  "/phone-verification/verify",
  otpLimiter,
  validateBody(z.object({
    challengeToken: z.string().min(32),
    code: z.string().regex(/^\d{4,8}$/)
  })),
  async (req, res) => {
    try {
      const verified = await completePhoneVerification(req.body.challengeToken, req.body.code);
      const session = await createAuthenticatedSession(verified.userId);
      if (!session) return res.status(403).json({ error: "Phone verified. Your paid subscription is pending activation.", reason: "SUBSCRIPTION_REQUIRED" });
      return res.json(session);
    } catch (error) {
      const verificationError = error instanceof PhoneVerificationError ? error : null;
      return res.status(verificationError?.status ?? 500).json({
        error: verificationError?.message ?? "Could not verify phone number",
        reason: verificationError?.code
      });
    }
  }
);

authRouter.post(
  "/phone-verification/resend",
  otpLimiter,
  validateBody(z.object({ challengeToken: z.string().min(32) })),
  async (req, res) => {
    try {
      return res.json(await resendPhoneVerification(req.body.challengeToken));
    } catch (error) {
      const verificationError = error instanceof PhoneVerificationError ? error : null;
      if (verificationError?.retryAfterSeconds) res.setHeader("Retry-After", verificationError.retryAfterSeconds);
      return res.status(verificationError?.status ?? 500).json({
        error: verificationError?.message ?? "Could not resend verification code",
        reason: verificationError?.code,
        retryAfterSeconds: verificationError?.retryAfterSeconds
      });
    }
  }
);

authRouter.get("/me", requireAuth, async (req, res) => {
  const context = await getAuthContext(req.user!.id);
  if (!context) return res.status(401).json({ error: "Authentication required" });
  return res.json(context);
});

authRouter.get("/security", requireAuth, async (req, res) => {
  const settings = await getSecuritySettings(req.user!.id);
  if (!settings) return res.status(404).json({ error: "Account not found" });
  return res.json(settings);
});

authRouter.put(
  "/security/two-factor",
  requireAuth,
  validateBody(z.object({ enabled: z.boolean(), currentPassword: z.string().min(8) })),
  async (req, res) => {
    try {
      return res.json(await updateSmsTwoFactor(req.user!.id, req.body.enabled, req.body.currentPassword));
    } catch (error) {
      return res.status(409).json({ error: error instanceof Error ? error.message : "Could not update two-factor authentication" });
    }
  }
);

authRouter.post(
  "/refresh",
  validateBody(z.object({ refreshToken: z.string().min(16) })),
  async (req, res) => {
    const result = await refreshSession(req.body.refreshToken);
    if (!result) return res.status(401).json({ error: "Invalid or expired refresh token" });
    return res.json(result);
  }
);

authRouter.post(
  "/logout",
  validateBody(z.object({ refreshToken: z.string().min(16) })),
  async (req, res) => {
    await logout(req.body.refreshToken, req.user?.id);
    return res.json({ ok: true });
  }
);

authRouter.post(
  "/change-password",
  requireAuth,
  validateBody(z.object({ currentPassword: z.string().min(8), newPassword: z.string().min(8) })),
  async (req, res) => {
    try {
      await changePassword(req.user!.id, req.body.currentPassword, req.body.newPassword);
      return res.json({ ok: true });
    } catch (error) {
      return res.status(409).json({ error: error instanceof Error ? error.message : "Could not change password" });
    }
  }
);

authRouter.post(
  "/password-reset/request",
  passwordResetLimiter,
  validateBody(z.object({ email: z.string().email() })),
  async (req, res) => {
    await requestPasswordReset(req.body.email);
    return res.json({
      ok: true,
      message: "If that account exists, password reset instructions have been sent by email."
    });
  }
);

authRouter.post(
  "/password-reset/confirm",
  validateBody(z.object({ token: z.string().min(16), password: z.string().min(8) })),
  async (req, res) => {
    try {
      await resetPassword(req.body.token, req.body.password);
      return res.json({ ok: true });
    } catch (error) {
      return res.status(409).json({ error: error instanceof Error ? error.message : "Could not reset password" });
    }
  }
);

authRouter.post(
  "/accept-invite",
  validateBody(z.object({ token: z.string().min(16), password: z.string().min(8) })),
  async (req, res) => {
    try {
      const user = await acceptStaffInvite(req.body.token, req.body.password);
      return res.status(201).json({ ok: true, email: user.email, role: user.role });
    } catch (error) {
      return res.status(409).json({ error: error instanceof Error ? error.message : "Could not accept invite" });
    }
  }
);
