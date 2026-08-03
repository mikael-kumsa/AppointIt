import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireAuth } from "../../middleware/auth.js";

export const activityRouter = Router();
activityRouter.use(requireAuth);

activityRouter.get("/", async (req, res) => {
  const vendorId = req.user?.vendorId;
  const userId = req.user?.id;
  if (!vendorId || !userId) return res.status(403).json({ error: "Missing tenant" });
  const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) }).safeParse(req.query);
  if (!query.success) return res.status(400).json({ error: "Invalid activity limit" });
  const items = await prisma.activityNotification.findMany({
    where: { vendorId },
    include: { reads: { where: { userId }, select: { readAt: true } } },
    orderBy: { createdAt: "desc" },
    take: query.data.limit
  });
  return res.json(items.map(({ reads, ...item }) => ({ ...item, read: reads.length > 0 })));
});

activityRouter.post("/read-all", async (req, res) => {
  const vendorId = req.user?.vendorId;
  const userId = req.user?.id;
  if (!vendorId || !userId) return res.status(403).json({ error: "Missing tenant" });
  const unread = await prisma.activityNotification.findMany({
    where: { vendorId, reads: { none: { userId } } },
    select: { id: true },
    take: 250
  });
  if (unread.length) await prisma.activityNotificationRead.createMany({
    data: unread.map((item) => ({ notificationId: item.id, userId })),
    skipDuplicates: true
  });
  return res.sendStatus(204);
});

activityRouter.post("/:id/read", async (req, res) => {
  const vendorId = req.user?.vendorId;
  const userId = req.user?.id;
  if (!vendorId || !userId) return res.status(403).json({ error: "Missing tenant" });
  const item = await prisma.activityNotification.findFirst({ where: { id: String(req.params.id), vendorId }, select: { id: true } });
  if (!item) return res.status(404).json({ error: "Activity not found" });
  await prisma.activityNotificationRead.upsert({
    where: { notificationId_userId: { notificationId: item.id, userId } },
    update: { readAt: new Date() },
    create: { notificationId: item.id, userId }
  });
  return res.sendStatus(204);
});
