import { Router } from "express";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { enforceVendorLimit } from "../plans/plans.service.js";
import { publishLiveEvent } from "../live/live-events.js";

export const branchesRouter = Router();
branchesRouter.use(requireAuth);
const branchInput = z.object({ name: z.string().min(2), address: z.string().min(2), phone: z.string().optional(), timezone: z.string().optional(), active: z.boolean().optional() });

branchesRouter.get("/", async (req, res) => {
  if (!req.user?.vendorId) return res.status(403).json({ error: "Missing tenant" });
  const branches = await prisma.branch.findMany({ where: { vendorId: req.user.vendorId } });
  res.json(branches);
});

branchesRouter.post(
  "/",
  requireRole(UserRole.VENDOR_ADMIN),
  validateBody(branchInput),
  async (req, res) => {
    if (!req.user?.vendorId) return res.status(403).json({ error: "Missing tenant" });
    try {
      const currentCount = await prisma.branch.count({ where: { vendorId: req.user.vendorId, active: true } });
      await enforceVendorLimit(req.user.vendorId, "maxBranches", currentCount, "branches");
      const branch = await prisma.branch.create({ data: { ...req.body, vendorId: req.user.vendorId } });
      publishLiveEvent(req.user.vendorId, ["branches", "vendor"]);
      return res.status(201).json(branch);
    } catch (error) {
      return res.status(409).json({ error: error instanceof Error ? error.message : "Could not add branch" });
    }
  }
);

branchesRouter.patch("/:id", requireRole(UserRole.VENDOR_ADMIN), validateBody(branchInput.partial()), async (req, res) => {
  const existing = await prisma.branch.findFirst({ where: { id: String(req.params.id), vendorId: req.user!.vendorId! } });
  if (!existing) return res.status(404).json({ error: "Branch not found" });
  if (req.body.active === true && !existing.active) {
    const currentCount = await prisma.branch.count({ where: { vendorId: req.user!.vendorId!, active: true } });
    try {
      await enforceVendorLimit(req.user!.vendorId!, "maxBranches", currentCount, "branches");
    } catch (error) {
      return res.status(409).json({ error: error instanceof Error ? error.message : "Could not reactivate branch" });
    }
  }
  const branch = await prisma.branch.update({ where: { id: existing.id }, data: req.body });
  publishLiveEvent(req.user!.vendorId!, ["branches", "vendor"]);
  return res.json(branch);
});

branchesRouter.delete("/:id", requireRole(UserRole.VENDOR_ADMIN), async (req, res) => {
  const vendorId = req.user!.vendorId!;
  const existing = await prisma.branch.findFirst({ where: { id: String(req.params.id), vendorId } });
  if (!existing) return res.status(404).json({ error: "Branch not found" });
  const activeCount = await prisma.branch.count({ where: { vendorId, active: true } });
  if (existing.active && activeCount <= 1) return res.status(409).json({ error: "A business must keep at least one active branch" });
  const branch = await prisma.branch.update({ where: { id: existing.id }, data: { active: false } });
  publishLiveEvent(vendorId, ["branches", "vendor"]);
  return res.json(branch);
});

branchesRouter.delete("/:id/permanent", requireRole(UserRole.VENDOR_ADMIN), async (req, res) => {
  const existing = await prisma.branch.findFirst({ where: { id: String(req.params.id), vendorId: req.user!.vendorId! } });
  if (!existing) return res.status(404).json({ error: "Branch not found" });
  if (existing.active) return res.status(409).json({ error: "Deactivate this branch before deleting it permanently" });
  const [appointments, staff] = await Promise.all([
    prisma.appointment.count({ where: { branchId: existing.id } }),
    prisma.staff.count({ where: { branchId: existing.id } })
  ]);
  if (appointments + staff > 0) return res.status(409).json({ error: "This branch has staff or appointment history and must remain archived" });
  await prisma.$transaction(async (tx) => {
    await tx.workingHour.deleteMany({ where: { branchId: existing.id } });
    await tx.breakTime.deleteMany({ where: { branchId: existing.id } });
    await tx.holiday.deleteMany({ where: { branchId: existing.id } });
    await tx.branch.delete({ where: { id: existing.id } });
  });
  publishLiveEvent(req.user!.vendorId!, ["branches", "availability", "vendor"]);
  return res.sendStatus(204);
});
