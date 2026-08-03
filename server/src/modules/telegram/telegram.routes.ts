import { Router } from "express";
import { UserRole } from "@prisma/client";
import { env } from "../../config/env.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { completeTelegramLogin, startTelegramLogin } from "./telegram-login.service.js";

export const telegramRouter = Router();

telegramRouter.post(
  "/login/start",
  requireAuth,
  requireRole(UserRole.VENDOR_ADMIN),
  async (req, res) => {
    if (!req.user?.vendorId) return res.status(403).json({ error: "Missing tenant" });
    const result = await startTelegramLogin(req.user.vendorId);
    if (!result.ok) return res.status(503).json({ error: result.error });
    res.json({ url: result.url });
  }
);

telegramRouter.get("/login/callback", async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const failedRedirect = new URL("/login", env.APP_ORIGIN);
  if (!code || !state) {
    failedRedirect.searchParams.set("telegramVerification", "failed");
    failedRedirect.searchParams.set("reason", "Missing Telegram authorization response");
    return res.redirect(failedRedirect.toString());
  }

  try {
    const result = await completeTelegramLogin(code, state);
    const redirect = new URL(result.requiresLogin ? "/login" : "/dashboard", env.APP_ORIGIN);
    redirect.searchParams.set("telegramVerification", "success");
    if (result.userEmail) redirect.searchParams.set("email", result.userEmail);
    return res.redirect(redirect.toString());
  } catch (error) {
    failedRedirect.searchParams.set("telegramVerification", "failed");
    failedRedirect.searchParams.set("reason", error instanceof Error ? error.message : "Telegram verification failed");
    return res.redirect(failedRedirect.toString());
  }
});
