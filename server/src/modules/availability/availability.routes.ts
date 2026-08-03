import { Router } from "express";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { publishLiveEvent } from "../live/live-events.js";
import { diagnoseAvailability } from "./availability.service.js";

export const availabilityRouter = Router();

availabilityRouter.use(requireAuth);

const timeSchema = z.string().regex(/^\d{2}:\d{2}$/);
const timeWindowFields = {
  weekday: z.number().int().min(0).max(6),
  startTime: timeSchema,
  endTime: timeSchema
};
const timeWindowSchema = z.object(timeWindowFields).refine((value) => value.startTime < value.endTime, { message: "Start time must be before end time" });
type WorkingHourInput = {
  weekday: number;
  startTime: string;
  endTime: string;
};

async function validateScope(vendorId: string, branchId?: string | null, staffId?: string | null) {
  if (branchId && staffId) throw new Error("Choose either a branch or a staff member, not both");
  if (branchId && !await prisma.branch.findFirst({ where: { id: branchId, vendorId, active: true }, select: { id: true } })) throw new Error("Choose an active branch from this business");
  if (staffId && !await prisma.staff.findFirst({ where: { id: staffId, vendorId, active: true }, select: { id: true } })) throw new Error("Choose an active staff member from this business");
}

availabilityRouter.get("/", async (req, res) => {
  if (!req.user?.vendorId) return res.status(403).json({ error: "Missing tenant" });
  const [workingHours, breakTimes, holidays] = await Promise.all([
    prisma.workingHour.findMany({ where: { vendorId: req.user.vendorId }, orderBy: [{ weekday: "asc" }, { startTime: "asc" }] }),
    prisma.breakTime.findMany({ where: { vendorId: req.user.vendorId }, orderBy: [{ weekday: "asc" }, { startTime: "asc" }] }),
    prisma.holiday.findMany({ where: { vendorId: req.user.vendorId }, orderBy: { date: "asc" } })
  ]);
  res.json({ workingHours, breakTimes, holidays });
});

availabilityRouter.get("/diagnose", async (req, res) => {
  if (!req.user?.vendorId) return res.status(403).json({ error: "Missing tenant" });
  const query = z.object({
    branchId: z.string().min(1),
    serviceId: z.string().min(1),
    date: z.coerce.date(),
    staffId: z.string().optional()
  }).safeParse(req.query);
  if (!query.success) return res.status(400).json({ error: "Choose a branch, service, and date to check availability" });

  const diagnosis = await diagnoseAvailability(
    prisma,
    req.user.vendorId,
    query.data.branchId,
    query.data.serviceId,
    query.data.date,
    query.data.staffId
  );
  res.json(diagnosis);
});

availabilityRouter.put(
  "/working-hours",
  requireRole(UserRole.VENDOR_ADMIN, UserRole.RECEPTIONIST),
  validateBody(z.object({
    scope: z.enum(["vendor", "branch", "staff"]).default("vendor"),
    branchId: z.string().optional(),
    staffId: z.string().optional(),
    hours: z.array(timeWindowSchema)
  })),
  async (req, res) => {
    if (!req.user?.vendorId) return res.status(403).json({ error: "Missing tenant" });

    const branchId = req.body.scope === "branch" ? req.body.branchId : null;
    const staffId = req.body.scope === "staff" ? req.body.staffId : null;
    if (req.body.scope === "branch" && !branchId) return res.status(400).json({ error: "branchId is required" });
    if (req.body.scope === "staff" && !staffId) return res.status(400).json({ error: "staffId is required" });
    try { await validateScope(req.user.vendorId, branchId, staffId); }
    catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "Invalid availability scope" }); }

    const rows = await prisma.$transaction(async (tx) => {
      await tx.workingHour.deleteMany({
        where: {
          vendorId: req.user!.vendorId!,
          branchId,
          staffId
        }
      });
      if (req.body.hours.length === 0) return [];
      await tx.workingHour.createMany({
        data: req.body.hours.map((hour: WorkingHourInput) => ({
          vendorId: req.user!.vendorId!,
          branchId,
          staffId,
          weekday: hour.weekday,
          startTime: hour.startTime,
          endTime: hour.endTime
        }))
      });
      return tx.workingHour.findMany({
        where: { vendorId: req.user!.vendorId!, branchId, staffId },
        orderBy: [{ weekday: "asc" }, { startTime: "asc" }]
      });
    });

    publishLiveEvent(req.user.vendorId, ["availability"]);
    res.json(rows);
  }
);

availabilityRouter.post(
  "/break-times",
  requireRole(UserRole.VENDOR_ADMIN, UserRole.RECEPTIONIST),
  validateBody(z.object({
    ...timeWindowFields,
    branchId: z.string().optional(),
    staffId: z.string().optional()
  }).refine((value) => value.startTime < value.endTime, { message: "Start time must be before end time" })),
  async (req, res) => {
    if (!req.user?.vendorId) return res.status(403).json({ error: "Missing tenant" });
    try { await validateScope(req.user.vendorId, req.body.branchId, req.body.staffId); }
    catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "Invalid availability scope" }); }
    const breakTime = await prisma.breakTime.create({
      data: {
        vendorId: req.user.vendorId,
        branchId: req.body.branchId,
        staffId: req.body.staffId,
        weekday: req.body.weekday,
        startTime: req.body.startTime,
        endTime: req.body.endTime
      }
    });
    publishLiveEvent(req.user.vendorId, ["availability"]);
    res.status(201).json(breakTime);
  }
);

availabilityRouter.delete("/break-times/:id", requireRole(UserRole.VENDOR_ADMIN, UserRole.RECEPTIONIST), async (req, res) => {
  if (!req.user?.vendorId) return res.status(403).json({ error: "Missing tenant" });
  const existing = await prisma.breakTime.findFirst({ where: { id: String(req.params.id), vendorId: req.user.vendorId } });
  if (!existing) return res.status(404).json({ error: "Break time not found" });
  await prisma.breakTime.delete({ where: { id: existing.id } });
  publishLiveEvent(req.user.vendorId, ["availability"]);
  res.sendStatus(204);
});

availabilityRouter.post(
  "/holidays",
  requireRole(UserRole.VENDOR_ADMIN, UserRole.RECEPTIONIST),
  validateBody(z.object({
    branchId: z.string().optional(),
    staffId: z.string().optional(),
    date: z.coerce.date(),
    reason: z.string().optional()
  })),
  async (req, res) => {
    if (!req.user?.vendorId) return res.status(403).json({ error: "Missing tenant" });
    try { await validateScope(req.user.vendorId, req.body.branchId, req.body.staffId); }
    catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "Invalid availability scope" }); }
    const holiday = await prisma.holiday.create({
      data: {
        vendorId: req.user.vendorId,
        branchId: req.body.branchId,
        staffId: req.body.staffId,
        date: req.body.date,
        reason: req.body.reason
      }
    });
    publishLiveEvent(req.user.vendorId, ["availability"]);
    res.status(201).json(holiday);
  }
);

availabilityRouter.delete("/holidays/:id", requireRole(UserRole.VENDOR_ADMIN, UserRole.RECEPTIONIST), async (req, res) => {
  if (!req.user?.vendorId) return res.status(403).json({ error: "Missing tenant" });
  const existing = await prisma.holiday.findFirst({ where: { id: String(req.params.id), vendorId: req.user.vendorId } });
  if (!existing) return res.status(404).json({ error: "Holiday not found" });
  await prisma.holiday.delete({ where: { id: existing.id } });
  publishLiveEvent(req.user.vendorId, ["availability"]);
  res.sendStatus(204);
});
