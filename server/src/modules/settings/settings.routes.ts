import { Router } from "express";
import { AppointmentStatus, LogStatus, NotificationChannel, Prisma, UserRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { decryptSecret, encryptSecret } from "../../utils/crypto.js";
import { appointmentRules, defaultAppointmentRules } from "../appointments/appointment-management.service.js";
import { defaultReminderSettings, normalizeReminderOffsets, reminderSettings } from "../notifications/reminder-settings.js";
import { cancelAppointmentReminderJobs, scheduleAppointmentReminders } from "../notifications/notification.queue.js";
import { enqueueAppointmentNotification } from "../notifications/notification.queue.js";
import { requireActiveVendorEntitlements } from "../plans/plans.service.js";
import { publishLiveEvent } from "../live/live-events.js";
import { sendSms } from "../notifications/sms.service.js";

export const settingsRouter = Router();

settingsRouter.use(requireAuth, requireRole(UserRole.VENDOR_ADMIN));

const reminderSettingsSchema = z.object({
  automaticEnabled: z.boolean(),
  offsetsMinutes: z.array(z.number().int().min(15).max(10_080)).max(6)
}).refine((value) => !value.automaticEnabled || value.offsetsMinutes.length > 0, { message: "Choose at least one timing or use Manual only" });

settingsRouter.get("/reminders", async (req, res) => {
  const vendorId = req.user?.vendorId;
  if (!vendorId) return res.status(403).json({ error: "Missing tenant" });
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { settings: true } });
  return res.json(vendor ? reminderSettings(vendor.settings) : defaultReminderSettings);
});

settingsRouter.put("/reminders", validateBody(reminderSettingsSchema), async (req, res) => {
  const vendorId = req.user?.vendorId;
  if (!vendorId) return res.status(403).json({ error: "Missing tenant" });
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { settings: true } });
  if (!vendor) return res.status(404).json({ error: "Vendor not found" });
  const previous = reminderSettings(vendor.settings);
  const next = { automaticEnabled: req.body.automaticEnabled, offsetsMinutes: normalizeReminderOffsets(req.body.offsetsMinutes) };
  const current = vendor.settings && typeof vendor.settings === "object" && !Array.isArray(vendor.settings) ? vendor.settings as Prisma.JsonObject : {};
  await prisma.vendor.update({ where: { id: vendorId }, data: { settings: { ...current, reminderSettings: next } } });
  const appointments = await prisma.appointment.findMany({
    where: { vendorId, startAt: { gt: new Date() }, status: { in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED, AppointmentStatus.RESCHEDULED] } },
    select: { id: true }
  });
  await Promise.all(appointments.map(async ({ id }) => {
    await cancelAppointmentReminderJobs(id, previous.offsetsMinutes);
    await scheduleAppointmentReminders(id);
  }));
  publishLiveEvent(vendorId, ["vendor", "notifications"]);
  return res.json({ ...next, rescheduledAppointments: appointments.length });
});

settingsRouter.get("/notification-logs", async (req, res) => {
  const vendorId = req.user?.vendorId;
  if (!vendorId) return res.status(403).json({ error: "Missing tenant" });
  const status = typeof req.query.status === "string" && ["PENDING", "SENT", "FAILED", "DELIVERED", "READ"].includes(req.query.status) ? req.query.status as "PENDING" | "SENT" | "FAILED" | "DELIVERED" | "READ" : undefined;
  const logs = await prisma.notificationLog.findMany({
    where: { vendorId, ...(status ? { status } : {}) },
    include: { appointment: { select: { customer: { select: { name: true } }, service: { select: { name: true } } } } },
    orderBy: { createdAt: "desc" },
    take: 50
  });
  return res.json(logs);
});

settingsRouter.get("/reminder-schedules", async (req, res) => {
  const vendorId = req.user?.vendorId;
  if (!vendorId) return res.status(403).json({ error: "Missing tenant" });
  const schedules = await prisma.reminderSchedule.findMany({
    where: { vendorId },
    include: {
      appointment: {
        select: {
          startAt: true,
          status: true,
          customer: { select: { name: true, phone: true, smsOptIn: true } },
          service: { select: { name: true } },
          staff: { select: { name: true } }
        }
      },
      notificationLog: { select: { status: true, errorMessage: true, providerMessageId: true, attemptCount: true } }
    },
    orderBy: [{ scheduledFor: "asc" }],
    take: 80
  });
  return res.json(schedules);
});

settingsRouter.post("/notification-logs/:id/retry", async (req, res) => {
  const vendorId = req.user?.vendorId;
  if (!vendorId) return res.status(403).json({ error: "Missing tenant" });
  const log = await prisma.notificationLog.findFirst({ where: { id: String(req.params.id), vendorId, status: "FAILED", appointmentId: { not: null } } });
  if (!log?.appointmentId) return res.status(404).json({ error: "Failed notification not found" });
  await enqueueAppointmentNotification(log.appointmentId, log.type, { notificationKey: `retry-${log.id}-${Date.now()}` });
  publishLiveEvent(vendorId, ["notifications"]);
  return res.status(202).json({ queued: true });
});

const appointmentRulesSchema = z.object({
  allowCustomerCancellation: z.boolean(),
  allowCustomerReschedule: z.boolean(),
  cancellationNoticeHours: z.number().int().min(0).max(168),
  rescheduleNoticeHours: z.number().int().min(0).max(168),
  maxCustomerReschedules: z.number().int().min(0).max(10)
});

settingsRouter.get("/appointment-rules", async (req, res) => {
  const vendorId = req.user?.vendorId;
  if (!vendorId) return res.status(403).json({ error: "Missing tenant" });
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { settings: true } });
  return res.json(vendor ? appointmentRules(vendor.settings) : defaultAppointmentRules);
});

settingsRouter.put("/appointment-rules", validateBody(appointmentRulesSchema), async (req, res) => {
  const vendorId = req.user?.vendorId;
  if (!vendorId) return res.status(403).json({ error: "Missing tenant" });
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { settings: true } });
  if (!vendor) return res.status(404).json({ error: "Vendor not found" });
  const current = vendor.settings && typeof vendor.settings === "object" && !Array.isArray(vendor.settings) ? vendor.settings as Prisma.JsonObject : {};
  await prisma.vendor.update({ where: { id: vendorId }, data: { settings: { ...current, appointmentRules: req.body } } });
  return res.json(req.body);
});

settingsRouter.get("/messaging", async (req, res) => {
  const vendorId = req.user?.vendorId;
  if (!vendorId) return res.status(403).json({ error: "Missing tenant" });
  const settings = await prisma.messageSetting.findUnique({ where: { vendorId } });
  if (!settings) {
    return res.json({
      smsEnabled: false,
      smsProvider: "afromessage",
      smsGatewayUrl: null,
      encryptedSmsGatewayApiKey: false,
      smsIdentifierId: null,
      smsFrom: null
    });
  }
  res.json({
    smsEnabled: settings.smsEnabled,
    smsProvider: settings.smsProvider,
    smsGatewayUrl: settings.smsGatewayUrl,
    encryptedSmsGatewayApiKey: Boolean(settings.encryptedSmsGatewayApiKey),
    smsIdentifierId: settings.smsIdentifierId,
    smsFrom: settings.smsFrom
  });
});

settingsRouter.put(
  "/messaging",
  validateBody(z.object({
    smsEnabled: z.boolean().optional(),
    smsProvider: z.enum(["afromessage", "geez", "http"]).optional(),
    smsGatewayUrl: z.string().optional(),
    smsGatewayApiKey: z.string().optional(),
    smsIdentifierId: z.string().optional(),
    smsFrom: z.string().optional()
  })),
  async (req, res) => {
    const vendorId = req.user?.vendorId;
    if (!vendorId) return res.status(403).json({ error: "Missing tenant" });
    const smsGatewayUrl = req.body.smsGatewayUrl?.trim() || null;
    const smsIdentifierId = req.body.smsIdentifierId?.trim() || null;
    const smsFrom = req.body.smsFrom?.trim() || null;
    const smsGatewayApiKey = req.body.smsGatewayApiKey?.trim();
    if (req.body.smsEnabled === true) {
      const plan = await requireActiveVendorEntitlements(vendorId).catch(() => null);
      if (!plan) return res.status(403).json({ error: "An active paid subscription is required" });
      if (!plan.entitlements.smsAutomation) return res.status(403).json({ error: "SMS automation is not included in the current subscription" });
      const existing = await prisma.messageSetting.findUnique({ where: { vendorId } });
      if (!smsGatewayApiKey && !existing?.encryptedSmsGatewayApiKey) return res.status(400).json({ error: "Add an AfroMessage API token before enabling SMS reminders" });
    }
    const settings = await prisma.messageSetting.upsert({
      where: { vendorId },
      update: {
        smsEnabled: req.body.smsEnabled,
        smsProvider: req.body.smsProvider,
        smsGatewayUrl,
        encryptedSmsGatewayApiKey: smsGatewayApiKey ? encryptSecret(smsGatewayApiKey) : undefined,
        smsIdentifierId,
        smsFrom
      },
      create: {
        vendorId,
        smsEnabled: req.body.smsEnabled ?? false,
        smsProvider: req.body.smsProvider,
        smsGatewayUrl,
        encryptedSmsGatewayApiKey: smsGatewayApiKey ? encryptSecret(smsGatewayApiKey) : undefined,
        smsIdentifierId,
        smsFrom
      }
    });
    publishLiveEvent(vendorId, ["vendor", "notifications"]);
    res.json({
      smsEnabled: settings.smsEnabled,
      smsProvider: settings.smsProvider,
      smsGatewayUrl: settings.smsGatewayUrl,
      encryptedSmsGatewayApiKey: Boolean(settings.encryptedSmsGatewayApiKey),
      smsIdentifierId: settings.smsIdentifierId,
      smsFrom: settings.smsFrom
    });
  }
);

settingsRouter.post(
  "/messaging/test",
  validateBody(z.object({
    phone: z.string().trim().min(6).max(30),
    message: z.string().trim().min(5).max(480).optional()
  })),
  async (req, res) => {
    const vendorId = req.user?.vendorId;
    if (!vendorId) return res.status(403).json({ error: "Missing tenant" });
    const [settings, vendor] = await Promise.all([
      prisma.messageSetting.findUnique({ where: { vendorId } }),
      prisma.vendor.findUnique({ where: { id: vendorId }, select: { name: true } })
    ]);
    if (!settings?.smsEnabled) return res.status(409).json({ error: "SMS reminders are disabled. Enable SMS reminders before sending a test." });
    if (!settings.encryptedSmsGatewayApiKey) return res.status(409).json({ error: "Add the vendor AfroMessage API token before sending a test." });

    const log = await prisma.notificationLog.create({
      data: {
        vendorId,
        channel: NotificationChannel.SMS,
        type: "test",
        status: LogStatus.PENDING,
        idempotencyKey: `test:${vendorId}:${Date.now()}`,
        attemptCount: 1,
        lastAttemptAt: new Date()
      }
    });

    try {
      const result = await sendSms({
        to: req.body.phone,
        message: req.body.message || `AppointIt test SMS from ${vendor?.name ?? "your business"}. Your reminder settings are working.`,
        from: settings.smsFrom,
        vendorId,
        provider: settings.smsProvider,
        gatewayUrl: settings.smsGatewayUrl,
        apiKey: decryptSecret(settings.encryptedSmsGatewayApiKey),
        identifierId: settings.smsIdentifierId
      });
      const updated = await prisma.notificationLog.update({
        where: { id: log.id },
        data: { status: LogStatus.SENT, providerMessageId: result.providerMessageId }
      });
      publishLiveEvent(vendorId, ["notifications"]);
      return res.status(202).json({ sent: true, providerMessageId: updated.providerMessageId });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Test SMS failed";
      await prisma.notificationLog.update({ where: { id: log.id }, data: { status: LogStatus.FAILED, errorMessage: message } });
      publishLiveEvent(vendorId, ["notifications"]);
      return res.status(502).json({ error: message });
    }
  }
);

settingsRouter.get("/templates", async (req, res) => {
  const vendorId = req.user?.vendorId;
  if (!vendorId) return res.status(403).json({ error: "Missing tenant" });
  return res.json(await prisma.messageTemplate.findMany({ where: { vendorId }, orderBy: [{ channel: "asc" }, { type: "asc" }] }));
});

settingsRouter.put(
  "/templates/:type",
  validateBody(z.object({
    channel: z.enum(["EMAIL", "SMS"]),
    templateName: z.string().optional(),
    subject: z.string().max(160).nullable().optional(),
    body: z.string().min(5),
    active: z.boolean().default(true)
  })),
  async (req, res) => {
    const vendorId = req.user?.vendorId;
    if (!vendorId) return res.status(403).json({ error: "Missing tenant" });
    const type = String(req.params.type);
    if (!["confirmation", "reminder", "cancellation", "reschedule", "follow_up"].includes(type)) return res.status(400).json({ error: "Unsupported notification type" });
    const template = await prisma.messageTemplate.upsert({
      where: { vendorId_channel_type: { vendorId, channel: req.body.channel, type } },
      update: req.body,
      create: { ...req.body, type, vendorId }
    });
    publishLiveEvent(vendorId, ["notifications"]);
    res.json(template);
  }
);

settingsRouter.delete("/templates/:id", async (req, res) => {
  const vendorId = req.user?.vendorId;
  if (!vendorId) return res.status(403).json({ error: "Missing tenant" });
  const template = await prisma.messageTemplate.findFirst({ where: { id: String(req.params.id), vendorId } });
  if (!template) return res.status(404).json({ error: "Template not found" });
  await prisma.messageTemplate.delete({ where: { id: template.id } });
  publishLiveEvent(vendorId, ["notifications"]);
  return res.sendStatus(204);
});
