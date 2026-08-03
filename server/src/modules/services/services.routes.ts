import { Router } from "express";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { publishLiveEvent } from "../live/live-events.js";

export const servicesRouter = Router();
servicesRouter.use(requireAuth);
const serviceInput = z.object({
  name: z.string().min(2), description: z.string().optional(), category: z.string().optional(), priceCents: z.number().int().nonnegative().default(0),
  durationMinutes: z.number().int().positive(), bufferBeforeMinutes: z.number().int().nonnegative().default(0), bufferAfterMinutes: z.number().int().nonnegative().default(0), active: z.boolean().optional()
});

servicesRouter.get("/", async (req, res) => {
  if (!req.user?.vendorId) return res.status(403).json({ error: "Missing tenant" });
  const services = await prisma.service.findMany({ where: { vendorId: req.user.vendorId }, orderBy: { name: "asc" } });
  res.json(services);
});

servicesRouter.post(
  "/",
  requireRole(UserRole.VENDOR_ADMIN),
  validateBody(serviceInput),
  async (req, res) => {
    if (!req.user?.vendorId) return res.status(403).json({ error: "Missing tenant" });
    const service = await prisma.service.create({ data: { ...req.body, vendorId: req.user.vendorId } });
    publishLiveEvent(req.user.vendorId, ["services", "vendor"]);
    res.status(201).json(service);
  }
);

servicesRouter.patch("/:id", requireRole(UserRole.VENDOR_ADMIN), validateBody(serviceInput.partial()), async (req, res) => {
  const existing = await prisma.service.findFirst({ where: { id: String(req.params.id), vendorId: req.user!.vendorId! } });
  if (!existing) return res.status(404).json({ error: "Service not found" });
  const service = await prisma.service.update({ where: { id: existing.id }, data: req.body });
  publishLiveEvent(req.user!.vendorId!, ["services"]);
  return res.json(service);
});

servicesRouter.delete("/:id", requireRole(UserRole.VENDOR_ADMIN), async (req, res) => {
  const existing = await prisma.service.findFirst({ where: { id: String(req.params.id), vendorId: req.user!.vendorId! } });
  if (!existing) return res.status(404).json({ error: "Service not found" });
  const service = await prisma.service.update({ where: { id: existing.id }, data: { active: false } });
  publishLiveEvent(req.user!.vendorId!, ["services", "vendor"]);
  return res.json(service);
});

servicesRouter.delete("/:id/permanent", requireRole(UserRole.VENDOR_ADMIN), async (req, res) => {
  const existing = await prisma.service.findFirst({ where: { id: String(req.params.id), vendorId: req.user!.vendorId! } });
  if (!existing) return res.status(404).json({ error: "Service not found" });
  if (existing.active) return res.status(409).json({ error: "Deactivate this service before deleting it permanently" });
  const appointmentCount = await prisma.appointment.count({ where: { serviceId: existing.id } });
  if (appointmentCount > 0) return res.status(409).json({ error: "This service has appointment history and must remain archived" });
  await prisma.service.delete({ where: { id: existing.id } });
  publishLiveEvent(req.user!.vendorId!, ["services", "vendor"]);
  return res.sendStatus(204);
});
