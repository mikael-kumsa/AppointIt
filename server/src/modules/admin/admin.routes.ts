import { Router } from "express";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole(UserRole.SUPER_ADMIN));

adminRouter.get("/users", async (req, res) => {
  const query = z.object({ q: z.string().trim().max(100).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(100) }).safeParse(req.query);
  if (!query.success) return res.status(400).json({ error: "Invalid user filters" });
  const where = query.data.q ? { OR: [{ name: { contains: query.data.q, mode: "insensitive" as const } }, { email: { contains: query.data.q, mode: "insensitive" as const } }, { phone: { contains: query.data.q } }, { vendor: { name: { contains: query.data.q, mode: "insensitive" as const } } }] } : {};
  const [users, total] = await Promise.all([prisma.user.findMany({
    where,
    select: { id: true, name: true, email: true, phone: true, phoneVerifiedAt: true, role: true, active: true, createdAt: true, vendor: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" }, skip: (query.data.page - 1) * query.data.pageSize, take: query.data.pageSize
  }), prisma.user.count({ where })]);
  res.set("x-total-count", String(total));
  return res.json(users);
});

adminRouter.get("/logs", async (req, res) => {
  const query = z.object({ type: z.enum(["audit", "webhook", "notification"]).default("audit") }).parse(req.query);
  if (query.type === "webhook") return res.json(await prisma.webhookLog.findMany({ select: { id: true, provider: true, eventType: true, status: true, vendorId: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 300 }));
  if (query.type === "notification") return res.json(await prisma.notificationLog.findMany({ select: { id: true, channel: true, type: true, status: true, errorMessage: true, vendorId: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 300 }));
  return res.json(await prisma.auditLog.findMany({ select: { id: true, action: true, entityType: true, entityId: true, vendorId: true, actorUserId: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 300 }));
});
