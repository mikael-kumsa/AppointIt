import { Router } from "express";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { createStaffInvite, renewStaffInvite, sendStaffInviteEmail } from "./staff-invites.service.js";
import { enforceVendorLimit } from "../plans/plans.service.js";
import { receiveProfileImage, validatedProfileImage } from "../../utils/image-upload.js";
import { publishLiveEvent } from "../live/live-events.js";

export const staffRouter = Router();
staffRouter.use(requireAuth);
const staffInput = z.object({ branchId: z.string().nullable().optional(), name: z.string().min(2), roleTitle: z.string().min(2), phone: z.string().nullable().optional(), email: z.string().email().nullable().optional(), serviceIds: z.array(z.string()).default([]), active: z.boolean().optional() });

function serializeStaff<T extends { id: string; profileImageData?: Buffer | null; profileImageUpdatedAt?: Date | null }>(staff: T) {
  const { profileImageData: _profileImageData, ...safe } = staff;
  return { ...safe, profileImageUrl: staff.profileImageUpdatedAt ? `/api/public/assets/staff/${staff.id}/photo?v=${staff.profileImageUpdatedAt.getTime()}` : null };
}

async function validateStaffRelations(vendorId: string, branchId: string | null | undefined, serviceIds: string[]) {
  if (branchId && !await prisma.branch.findFirst({ where: { id: branchId, vendorId } })) throw new Error("Branch does not belong to this business");
  const uniqueServiceIds = [...new Set(serviceIds)];
  const count = await prisma.service.count({ where: { id: { in: uniqueServiceIds }, vendorId } });
  if (count !== uniqueServiceIds.length) throw new Error("One or more services do not belong to this business");
  return uniqueServiceIds;
}

staffRouter.get("/", async (req, res) => {
  if (!req.user?.vendorId) return res.status(403).json({ error: "Missing tenant" });
  const staff = await prisma.staff.findMany({ where: { vendorId: req.user.vendorId }, include: { services: true, workingHours: true } });
  res.json(staff.map(serializeStaff));
});

staffRouter.get("/users", requireRole(UserRole.VENDOR_ADMIN), async (req, res) => {
  const vendorId = req.user?.vendorId;
  if (!vendorId) return res.status(403).json({ error: "Missing tenant" });
  return res.json(await prisma.user.findMany({
    where: { vendorId, role: { in: [UserRole.RECEPTIONIST, UserRole.STAFF] } },
    select: { id: true, name: true, email: true, phone: true, role: true, active: true, createdAt: true, staffId: true, staff: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" }
  }));
});

staffRouter.patch(
  "/users/:id",
  requireRole(UserRole.VENDOR_ADMIN),
  validateBody(z.object({ active: z.boolean().optional(), role: z.enum(["RECEPTIONIST", "STAFF"]).optional(), staffId: z.string().nullable().optional() })),
  async (req, res) => {
    const vendorId = req.user?.vendorId;
    if (!vendorId) return res.status(403).json({ error: "Missing tenant" });
    const existing = await prisma.user.findFirst({ where: { id: String(req.params.id), vendorId, role: { in: [UserRole.RECEPTIONIST, UserRole.STAFF] } } });
    if (!existing) return res.status(404).json({ error: "Team account not found" });
    const role = req.body.role ?? existing.role;
    const staffId = req.body.staffId === undefined ? existing.staffId : req.body.staffId;
    if (role === UserRole.STAFF && !staffId) return res.status(400).json({ error: "Staff accounts must be linked to a staff profile" });
    if (staffId && !await prisma.staff.findFirst({ where: { id: staffId, vendorId } })) return res.status(400).json({ error: "Staff profile not found" });
    const user = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id: existing.id }, data: { active: req.body.active, role, staffId: role === UserRole.STAFF ? staffId : null } });
      if (req.body.active === false) await tx.authRefreshToken.updateMany({ where: { userId: existing.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditLog.create({ data: { vendorId, actorUserId: req.user?.id, action: "team_account_updated", entityType: "User", entityId: existing.id, metadata: { active: req.body.active, role, staffId } } });
      return updated;
    });
    publishLiveEvent(vendorId, ["staff", "users"]);
    return res.json(user);
  }
);

staffRouter.post(
  "/",
  requireRole(UserRole.VENDOR_ADMIN),
  validateBody(staffInput),
  async (req, res) => {
    if (!req.user?.vendorId) return res.status(403).json({ error: "Missing tenant" });
    try {
      const currentCount = await prisma.staff.count({ where: { vendorId: req.user.vendorId, active: true } });
      await enforceVendorLimit(req.user.vendorId, "maxStaff", currentCount, "staff members");
      const serviceIds = await validateStaffRelations(req.user.vendorId, req.body.branchId, req.body.serviceIds);
      const staff = await prisma.staff.create({
        data: {
          vendorId: req.user.vendorId,
          branchId: req.body.branchId,
          name: req.body.name,
          roleTitle: req.body.roleTitle,
          phone: req.body.phone,
          email: req.body.email,
          services: { create: serviceIds.map((serviceId: string) => ({ serviceId })) }
        }
      });
      publishLiveEvent(req.user.vendorId, ["staff", "vendor"]);
      return res.status(201).json(serializeStaff(staff));
    } catch (error) {
      return res.status(409).json({ error: error instanceof Error ? error.message : "Could not add staff member" });
    }
  }
);

staffRouter.patch("/:id", requireRole(UserRole.VENDOR_ADMIN), validateBody(staffInput.partial()), async (req, res) => {
  const vendorId = req.user!.vendorId!;
  const existing = await prisma.staff.findFirst({ where: { id: String(req.params.id), vendorId } });
  if (!existing) return res.status(404).json({ error: "Staff member not found" });
  try {
    if (req.body.active === true && !existing.active) {
      const currentCount = await prisma.staff.count({ where: { vendorId, active: true } });
      await enforceVendorLimit(vendorId, "maxStaff", currentCount, "staff members");
    }
    const serviceIds = req.body.serviceIds ? await validateStaffRelations(vendorId, req.body.branchId ?? existing.branchId ?? undefined, req.body.serviceIds) : undefined;
    const updated = await prisma.$transaction(async (tx) => {
      if (serviceIds) {
        await tx.staffService.deleteMany({ where: { staffId: existing.id } });
        await tx.staffService.createMany({ data: serviceIds.map((serviceId) => ({ staffId: existing.id, serviceId })) });
      }
      const { serviceIds: _serviceIds, ...data } = req.body;
      return tx.staff.update({ where: { id: existing.id }, data, include: { services: true, workingHours: true } });
    });
    publishLiveEvent(vendorId, ["staff"]);
    return res.json(serializeStaff(updated));
  } catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : "Could not update staff member" }); }
});

staffRouter.delete("/:id", requireRole(UserRole.VENDOR_ADMIN), async (req, res) => {
  const existing = await prisma.staff.findFirst({ where: { id: String(req.params.id), vendorId: req.user!.vendorId! } });
  if (!existing) return res.status(404).json({ error: "Staff member not found" });
  const staff = await prisma.staff.update({ where: { id: existing.id }, data: { active: false } });
  publishLiveEvent(req.user!.vendorId!, ["staff", "vendor"]);
  return res.json(staff);
});

staffRouter.put("/:id/photo", requireRole(UserRole.VENDOR_ADMIN), receiveProfileImage, async (req, res) => {
  const existing = await prisma.staff.findFirst({ where: { id: String(req.params.id), vendorId: req.user!.vendorId! } });
  if (!existing) return res.status(404).json({ error: "Staff member not found" });
  try {
    const image = validatedProfileImage(req.file);
    const staff = await prisma.staff.update({ where: { id: existing.id }, data: { profileImageData: image.data, profileImageMimeType: image.mimeType, profileImageUpdatedAt: image.updatedAt } });
    publishLiveEvent(req.user!.vendorId!, ["staff"]);
    return res.json(serializeStaff(staff));
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Could not upload profile image" });
  }
});

staffRouter.delete("/:id/photo", requireRole(UserRole.VENDOR_ADMIN), async (req, res) => {
  const existing = await prisma.staff.findFirst({ where: { id: String(req.params.id), vendorId: req.user!.vendorId! } });
  if (!existing) return res.status(404).json({ error: "Staff member not found" });
  await prisma.staff.update({ where: { id: existing.id }, data: { profileImageData: null, profileImageMimeType: null, profileImageUpdatedAt: null } });
  publishLiveEvent(req.user!.vendorId!, ["staff"]);
  return res.sendStatus(204);
});

staffRouter.delete("/:id/permanent", requireRole(UserRole.VENDOR_ADMIN), async (req, res) => {
  const existing = await prisma.staff.findFirst({ where: { id: String(req.params.id), vendorId: req.user!.vendorId! } });
  if (!existing) return res.status(404).json({ error: "Staff member not found" });
  if (existing.active) return res.status(409).json({ error: "Deactivate this staff member before deleting them permanently" });
  const [appointments, accounts, connections, invites] = await Promise.all([
    prisma.appointment.count({ where: { staffId: existing.id } }),
    prisma.user.count({ where: { staffId: existing.id } }),
    prisma.calendarConnection.count({ where: { staffId: existing.id } }),
    prisma.staffInvite.count({ where: { staffId: existing.id } })
  ]);
  if (appointments + accounts + connections + invites > 0) {
    return res.status(409).json({ error: "This staff member has account or appointment history and must remain archived" });
  }
  await prisma.$transaction(async (tx) => {
    await tx.workingHour.deleteMany({ where: { staffId: existing.id } });
    await tx.breakTime.deleteMany({ where: { staffId: existing.id } });
    await tx.holiday.deleteMany({ where: { staffId: existing.id } });
    await tx.staff.delete({ where: { id: existing.id } });
  });
  publishLiveEvent(req.user!.vendorId!, ["staff", "vendor"]);
  return res.sendStatus(204);
});

staffRouter.get("/invites", requireRole(UserRole.VENDOR_ADMIN), async (req, res) => {
  if (!req.user?.vendorId) return res.status(403).json({ error: "Missing tenant" });
  const invites = await prisma.staffInvite.findMany({
    where: { vendorId: req.user.vendorId },
    orderBy: { createdAt: "desc" },
    take: 100
  });
  res.json(invites);
});

staffRouter.post(
  "/invites",
  requireRole(UserRole.VENDOR_ADMIN),
  validateBody(z.object({
    staffId: z.string().optional(),
    email: z.string().email(),
    name: z.string().min(2),
    phone: z.string().optional(),
    role: z.enum(["RECEPTIONIST", "STAFF"])
  })),
  async (req, res) => {
    try {
      if (!req.user?.vendorId) return res.status(403).json({ error: "Missing tenant" });
      const result = await createStaffInvite({ ...req.body, vendorId: req.user.vendorId });
      let emailSent = true;
      try { await sendStaffInviteEmail(result.invite, result.inviteUrl); } catch { emailSent = false; }
      publishLiveEvent(req.user.vendorId, ["staff", "users"]);
      res.status(201).json({
        ...result.invite,
        inviteUrl: result.inviteUrl,
        token: result.token,
        emailSent
      });
    } catch (error) {
      res.status(409).json({ error: error instanceof Error ? error.message : "Could not create invite" });
    }
  }
);

staffRouter.post("/invites/:id/resend", requireRole(UserRole.VENDOR_ADMIN), async (req, res) => {
  try {
    const vendorId = req.user?.vendorId;
    if (!vendorId) return res.status(403).json({ error: "Missing tenant" });
    const result = await renewStaffInvite(vendorId, String(req.params.id));
    await sendStaffInviteEmail(result.invite, result.inviteUrl);
    publishLiveEvent(vendorId, ["staff", "users"]);
    return res.json({ ...result.invite, inviteUrl: result.inviteUrl, emailSent: true });
  } catch (error) {
    return res.status(409).json({ error: error instanceof Error ? error.message : "Could not resend invitation" });
  }
});

staffRouter.delete("/invites/:id", requireRole(UserRole.VENDOR_ADMIN), async (req, res) => {
  const vendorId = req.user?.vendorId;
  if (!vendorId) return res.status(403).json({ error: "Missing tenant" });
  const invite = await prisma.staffInvite.findFirst({ where: { id: String(req.params.id), vendorId, acceptedAt: null } });
  if (!invite) return res.status(404).json({ error: "Pending invitation not found" });
  await prisma.staffInvite.delete({ where: { id: invite.id } });
  publishLiveEvent(vendorId, ["staff", "users"]);
  return res.sendStatus(204);
});
