import { Router } from "express";
import { Prisma, UserRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireAuth } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { publishLiveEvent } from "../live/live-events.js";
import { normalizePhoneNumber, phoneSearchTerms } from "../../utils/phone.js";

export const customersRouter = Router();
customersRouter.use(requireAuth);

customersRouter.get("/", async (req, res) => {
  if (!req.user?.vendorId) return res.status(403).json({ error: "Missing tenant" });
  const query = z.object({ q: z.string().trim().max(100).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(100) }).safeParse(req.query);
  if (!query.success) return res.status(400).json({ error: "Invalid customer filters" });
  const tenantWhere = req.user.role === UserRole.STAFF
      ? { vendorId: req.user.vendorId, appointments: { some: { staffId: req.user.staffId ?? "__missing_staff__" } } }
      : { vendorId: req.user.vendorId };
  const appointmentWhere = req.user.role === UserRole.STAFF ? { staffId: req.user.staffId ?? "__missing_staff__" } : {};
  const phoneTerms = query.data.q ? phoneSearchTerms(query.data.q) : [];
  const where = { ...tenantWhere, ...(query.data.q ? { OR: [
    { name: { contains: query.data.q, mode: "insensitive" as const } },
    ...phoneTerms.map((term) => ({ phone: { contains: term } })),
    { email: { contains: query.data.q, mode: "insensitive" as const } }
  ] } : {}) };
  const [customers, total] = await Promise.all([
    prisma.customer.findMany({ where, include: { appointments: { where: appointmentWhere, take: 12, orderBy: { startAt: "desc" }, include: { service: true, staff: { select: { name: true } }, branch: { select: { name: true } } } } }, orderBy: { updatedAt: "desc" }, skip: (query.data.page - 1) * query.data.pageSize, take: query.data.pageSize }),
    prisma.customer.count({ where })
  ]);
  res.set("x-total-count", String(total));
  res.set("x-page", String(query.data.page));
  res.set("x-page-size", String(query.data.pageSize));
  res.json(customers);
});

customersRouter.patch(
  "/:id",
  validateBody(z.object({ name: z.string().min(2).optional(), phone: z.string().min(6).optional(), email: z.string().email().nullable().optional(), notes: z.string().optional(), smsOptIn: z.boolean().optional(), whatsappOptIn: z.boolean().optional(), telegramId: z.string().nullable().optional() })),
  async (req, res) => {
    if (!req.user?.vendorId) return res.status(403).json({ error: "Missing tenant" });
    if (req.user.role === UserRole.STAFF) return res.status(403).json({ error: "Insufficient permissions" });
    const existing = await prisma.customer.findFirst({
      where: { id: String(req.params.id), vendorId: req.user.vendorId }
    });
    if (!existing) return res.status(404).json({ error: "Customer not found" });

    const data = { ...req.body, ...(req.body.phone ? { phone: normalizePhoneNumber(req.body.phone) } : {}) };
    try {
      const customer = await prisma.customer.update({
        where: { id: existing.id },
        data,
        include: { appointments: { take: 12, orderBy: { startAt: "desc" }, include: { service: true, staff: { select: { name: true } }, branch: { select: { name: true } } } } }
      });
      publishLiveEvent(req.user.vendorId, ["customers"]);
      res.json(customer);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return res.status(409).json({ error: "Another customer already uses this phone number" });
      }
      throw error;
    }
  }
);
