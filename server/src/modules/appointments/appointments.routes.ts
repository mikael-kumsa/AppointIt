import { Router } from "express";
import { AppointmentSource, UserRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { cancelAppointment, completeAppointment, createAppointment, markNoShowAppointment, rescheduleAppointment } from "./appointments.service.js";
import { enqueueAppointmentNotification } from "../notifications/notification.queue.js";
import { publishLiveEvent } from "../live/live-events.js";

export const appointmentsRouter = Router();

const appointmentBody = z.object({
  branchId: z.string(),
  serviceId: z.string(),
  staffId: z.string().optional(),
  startAt: z.coerce.date(),
  notes: z.string().optional(),
  customer: z.object({
    name: z.string().min(2),
    phone: z.string().min(6),
    email: z.string().email().optional()
    ,smsOptIn: z.boolean().optional()
  })
});

appointmentsRouter.use(requireAuth);

appointmentsRouter.get("/", async (req, res) => {
  const vendorId = req.user?.vendorId;
  if (!vendorId && req.user?.role !== UserRole.SUPER_ADMIN) return res.status(403).json({ error: "Missing tenant" });

  const query = z.object({
    q: z.string().trim().max(100).optional(),
    status: z.enum(["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW", "RESCHEDULED"]).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(100)
  }).safeParse(req.query);
  if (!query.success) return res.status(400).json({ error: "Invalid appointment filters" });
  const filters = {
    ...(query.data.status ? { status: query.data.status } : {}),
    ...(query.data.from || query.data.to ? { startAt: { ...(query.data.from ? { gte: query.data.from } : {}), ...(query.data.to ? { lte: query.data.to } : {}) } } : {}),
    ...(query.data.q ? { OR: [
      { customer: { name: { contains: query.data.q, mode: "insensitive" as const } } },
      { customer: { phone: { contains: query.data.q } } },
      { service: { name: { contains: query.data.q, mode: "insensitive" as const } } },
      { staff: { name: { contains: query.data.q, mode: "insensitive" as const } } }
    ] } : {})
  };
  const tenantWhere = req.user?.role === UserRole.SUPER_ADMIN
    ? {}
    : req.user?.role === UserRole.STAFF
      ? { vendorId: vendorId!, staffId: req.user.staffId ?? "__missing_staff__" }
      : { vendorId: vendorId! };
  const where = { ...tenantWhere, ...filters };
  const [appointments, total] = await Promise.all([
    prisma.appointment.findMany({
      where,
      include: {
        customer: true,
        service: true,
        staff: true,
        branch: true,
        history: { orderBy: { createdAt: "desc" }, take: 10 },
        reminderSchedules: { orderBy: { scheduledFor: "asc" }, take: 8, include: { notificationLog: { select: { status: true, errorMessage: true, providerMessageId: true, attemptCount: true } } } }
      },
      orderBy: { startAt: "desc" },
      skip: (query.data.page - 1) * query.data.pageSize,
      take: query.data.pageSize
    }),
    prisma.appointment.count({ where })
  ]);
  res.set("x-total-count", String(total));
  res.set("x-page", String(query.data.page));
  res.set("x-page-size", String(query.data.pageSize));
  res.json(appointments);
});

appointmentsRouter.post(
  "/",
  requireRole(UserRole.VENDOR_ADMIN, UserRole.RECEPTIONIST),
  validateBody(appointmentBody),
  async (req, res) => {
    try {
      const vendorId = req.user?.vendorId;
      if (!vendorId) return res.status(403).json({ error: "Missing tenant" });
      const appointment = await createAppointment({ ...req.body, vendorId, source: AppointmentSource.DASHBOARD });
      return res.status(201).json(appointment);
    } catch (error) {
      return res.status(409).json({ error: error instanceof Error ? error.message : "Booking failed" });
    }
  }
);

appointmentsRouter.post("/:id/reschedule", validateBody(z.object({ startAt: z.coerce.date(), staffId: z.string().optional() })), async (req, res) => {
  try {
    const vendorId = req.user?.vendorId;
    if (!vendorId) return res.status(403).json({ error: "Missing tenant" });
    if (req.user?.role === UserRole.STAFF) return res.status(403).json({ error: "Insufficient permissions" });
    const appointment = await rescheduleAppointment(vendorId, String(req.params.id), req.body.startAt, req.body.staffId, "staff", req.user?.id);
    return res.json(appointment);
  } catch (error) {
    return res.status(409).json({ error: error instanceof Error ? error.message : "Reschedule failed" });
  }
});

appointmentsRouter.post("/:id/revoke-management", requireRole(UserRole.VENDOR_ADMIN, UserRole.RECEPTIONIST), async (req, res) => {
  const vendorId = req.user?.vendorId;
  if (!vendorId) return res.status(403).json({ error: "Missing tenant" });
  const appointment = await prisma.appointment.findFirst({ where: { id: String(req.params.id), vendorId }, select: { id: true } });
  if (!appointment) return res.status(404).json({ error: "Appointment not found" });
  await prisma.appointment.update({ where: { id: appointment.id }, data: { managementTokenVersion: { increment: 1 }, history: { create: { action: "management_link_revoked", actorUserId: req.user?.id } } } });
  publishLiveEvent(vendorId, ["appointments"]);
  return res.sendStatus(204);
});

appointmentsRouter.post("/:id/remind", requireRole(UserRole.VENDOR_ADMIN, UserRole.RECEPTIONIST), async (req, res) => {
  const vendorId = req.user?.vendorId;
  if (!vendorId) return res.status(403).json({ error: "Missing tenant" });
  const appointment = await prisma.appointment.findFirst({
    where: { id: String(req.params.id), vendorId },
    include: { customer: true, vendor: { include: { messageSettings: true } } }
  });
  if (!appointment) return res.status(404).json({ error: "Appointment not found" });
  if (appointment.startAt <= new Date() || !["PENDING", "CONFIRMED", "RESCHEDULED"].includes(appointment.status)) {
    return res.status(409).json({ error: "Reminders can only be sent for upcoming active appointments" });
  }
  const settings = appointment.vendor.messageSettings;
  if (!settings?.smsEnabled) return res.status(409).json({ error: "SMS reminders are disabled. Enable them under Settings > Notifications." });
  if (!settings.encryptedSmsGatewayApiKey) return res.status(409).json({ error: "Add the vendor AfroMessage API token under Settings > Notifications before sending reminders." });
  if (!appointment.customer.phone) return res.status(409).json({ error: "This customer does not have a phone number." });
  if (!appointment.customer.smsOptIn) return res.status(409).json({ error: "This customer has not consented to SMS. Record their consent in Customers before sending a reminder." });
  const channels = ["sms"] as const;
  const queued = await enqueueAppointmentNotification(appointment.id, "manual_reminder", { jobId: `appointment:${appointment.id}:manual-${Date.now()}`, channels: [...channels] });
  if (!queued.queued) return res.status(503).json({ error: "The reminder queue is temporarily unavailable. Please try again." });
  await prisma.appointmentHistory.create({ data: { appointmentId: appointment.id, actorUserId: req.user?.id, action: "manual_reminder_requested", newValues: { channels } } });
  publishLiveEvent(vendorId, ["appointments", "notifications"]);
  return res.status(202).json({ queued: true, channels });
});

appointmentsRouter.post("/:id/cancel", validateBody(z.object({ reason: z.string().optional() })), async (req, res) => {
  try {
    const vendorId = req.user?.vendorId;
    if (!vendorId) return res.status(403).json({ error: "Missing tenant" });
    if (req.user?.role === UserRole.STAFF) return res.status(403).json({ error: "Insufficient permissions" });
    const id = String(req.params.id);
    const exists = await prisma.appointment.findFirst({ where: { id, vendorId } });
    if (!exists) return res.status(404).json({ error: "Appointment not found" });
    const appointment = await cancelAppointment(vendorId, id, req.body.reason, "staff", req.user?.id);
    return res.json(appointment);
  } catch (error) {
    return res.status(409).json({ error: error instanceof Error ? error.message : "Cancel failed" });
  }
});

appointmentsRouter.post("/:id/complete", async (req, res) => {
  try {
    const vendorId = req.user?.vendorId;
    if (!vendorId) return res.status(403).json({ error: "Missing tenant" });
    if (req.user?.role === UserRole.STAFF) {
      const existing = await prisma.appointment.findFirst({ where: { id: String(req.params.id), vendorId, staffId: req.user.staffId ?? "" } });
      if (!existing) return res.status(404).json({ error: "Appointment not found" });
    }
    const appointment = await completeAppointment(vendorId, String(req.params.id));
    return res.json(appointment);
  } catch (error) {
    return res.status(409).json({ error: error instanceof Error ? error.message : "Complete failed" });
  }
});

appointmentsRouter.post("/:id/no-show", async (req, res) => {
  try {
    const vendorId = req.user?.vendorId;
    if (!vendorId) return res.status(403).json({ error: "Missing tenant" });
    if (req.user?.role === UserRole.STAFF) {
      const existing = await prisma.appointment.findFirst({ where: { id: String(req.params.id), vendorId, staffId: req.user.staffId ?? "" } });
      if (!existing) return res.status(404).json({ error: "Appointment not found" });
    }
    const appointment = await markNoShowAppointment(vendorId, String(req.params.id));
    return res.json(appointment);
  } catch (error) {
    return res.status(409).json({ error: error instanceof Error ? error.message : "No-show update failed" });
  }
});
