import { Router } from "express";
import rateLimit from "express-rate-limit";
import crypto from "node:crypto";
import { LogStatus } from "@prisma/client";
import { prisma } from "../../db.js";
import { env } from "../../config/env.js";
import { ingestTelebirrSms } from "../payments/payments.service.js";
import { publishLiveEvent } from "../live/live-events.js";

export const webhooksRouter = Router();

webhooksRouter.use(rateLimit({ windowMs: 60_000, limit: 120 }));

function callbackSecretMatches(value: unknown) {
  if (!env.AFROMESSAGE_CALLBACK_SECRET || typeof value !== "string") return false;
  const supplied = Buffer.from(value);
  const expected = Buffer.from(env.AFROMESSAGE_CALLBACK_SECRET);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function gatewaySecretMatches(value: unknown) {
  if (!env.TELEBIRR_SMS_GATEWAY_SECRET || typeof value !== "string") return false;
  const supplied = Buffer.from(value);
  const expected = Buffer.from(env.TELEBIRR_SMS_GATEWAY_SECRET);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

webhooksRouter.post("/telebirr-sms", async (req, res) => {
  if (!gatewaySecretMatches(req.header("x-gateway-token"))) return res.status(401).json({ error: "Invalid gateway token" });
  const sender = typeof req.body?.sender === "string" ? req.body.sender : "";
  const message = typeof req.body?.message === "string" ? req.body.message : "";
  const deviceId = typeof req.body?.deviceId === "string" ? req.body.deviceId : undefined;
  if (!sender || !message || message.length > 4000) return res.status(400).json({ error: "Invalid SMS payload" });
  try {
    const result = await ingestTelebirrSms({ sender, message, deviceId });
    await prisma.webhookLog.create({ data: { provider: "telebirr_sms", eventType: "credit_received", payload: { sender, deviceId, transactionId: result.transactionId, duplicate: result.duplicate }, status: result.status.toLowerCase() } });
    return res.json({ ok: true, duplicate: result.duplicate, status: result.status });
  } catch (error) {
    await prisma.webhookLog.create({ data: { provider: "telebirr_sms", eventType: "credit_rejected", payload: { sender, deviceId, error: error instanceof Error ? error.message : "Invalid payment message" }, status: "failed" } });
    return res.status(422).json({ error: error instanceof Error ? error.message : "Invalid payment message" });
  }
});

function afroMessageLogStatus(value: string) {
  const status = value.toLowerCase();
  if (status.includes("deliver")) return LogStatus.DELIVERED;
  if (status.includes("read")) return LogStatus.READ;
  if (["fail", "reject", "undeliver", "expire", "cancel"].some((part) => status.includes(part))) return LogStatus.FAILED;
  if (["sent", "submit", "accept", "success"].some((part) => status.includes(part))) return LogStatus.SENT;
  return LogStatus.PENDING;
}

webhooksRouter.get("/afromessage/status", async (req, res) => {
  if (!callbackSecretMatches(req.query.secret)) return res.status(401).json({ error: "Invalid callback secret" });
  const messageId = typeof req.query.message_id === "string" ? req.query.message_id : "";
  const providerStatus = typeof req.query.status === "string" ? req.query.status : "";
  if (!messageId || !providerStatus) return res.status(400).json({ error: "Missing message_id or status" });

  const notification = await prisma.notificationLog.findFirst({
    where: { providerMessageId: messageId },
    orderBy: { createdAt: "desc" }
  });
  const status = afroMessageLogStatus(providerStatus);
  if (notification) {
    await prisma.notificationLog.update({ where: { id: notification.id }, data: { status } });
    publishLiveEvent(notification.vendorId, ["notifications", "logs"]);
  }
  await prisma.webhookLog.create({
    data: {
      vendorId: notification?.vendorId,
      provider: "afromessage",
      eventType: "delivery_status",
      payload: { messageId, providerStatus },
      status: notification ? status.toLowerCase() : "unmatched"
    }
  });
  return res.sendStatus(200);
});
