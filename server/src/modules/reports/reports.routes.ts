import { Router } from "express";
import { AppointmentStatus, UserRole } from "@prisma/client";
import { prisma } from "../../db.js";
import { requireAuth } from "../../middleware/auth.js";
import { z } from "zod";
import { requireActiveVendorEntitlements } from "../plans/plans.service.js";

export const reportsRouter = Router();

reportsRouter.use(requireAuth);

reportsRouter.get("/overview", async (req, res) => {
  const vendorId = req.user?.vendorId;
  if (!vendorId) return res.status(403).json({ error: "Missing tenant" });
  const query = z.object({ days: z.coerce.number().int().min(7).max(90).default(30) }).safeParse(req.query);
  if (!query.success) return res.status(400).json({ error: "Invalid overview range" });
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { timezone: true } });
  if (!vendor) return res.status(404).json({ error: "Vendor not found" });
  const from = new Date();
  from.setUTCHours(0, 0, 0, 0);
  from.setUTCDate(from.getUTCDate() - query.data.days + 1);
  const appointmentScope = req.user?.role === UserRole.STAFF
    ? { vendorId, staffId: req.user.staffId ?? "__missing_staff__", startAt: { gte: from } }
    : { vendorId, startAt: { gte: from } };
  const appointments = await prisma.appointment.findMany({
    where: appointmentScope,
    include: { service: { select: { id: true, name: true, priceCents: true } } },
    orderBy: { startAt: "asc" }
  });
  const dateKey = (value: Date) => {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: vendor.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
    const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
    return `${part("year")}-${part("month")}-${part("day")}`;
  };
  const days = new Map<string, { date: string; total: number; completed: number; cancelled: number; noShows: number; revenueCents: number }>();
  for (let index = 0; index < query.data.days; index += 1) {
    const date = new Date(from); date.setUTCDate(from.getUTCDate() + index);
    const key = dateKey(date);
    days.set(key, { date: key, total: 0, completed: 0, cancelled: 0, noShows: 0, revenueCents: 0 });
  }
  const status = new Map<string, number>();
  const services = new Map<string, { id: string; name: string; count: number }>();
  for (const item of appointments) {
    const daily = days.get(dateKey(item.startAt));
    if (daily) {
      daily.total += 1;
      if (item.status === AppointmentStatus.COMPLETED) { daily.completed += 1; daily.revenueCents += item.service.priceCents; }
      if (item.status === AppointmentStatus.CANCELLED) daily.cancelled += 1;
      if (item.status === AppointmentStatus.NO_SHOW) daily.noShows += 1;
    }
    status.set(item.status, (status.get(item.status) ?? 0) + 1);
    const service = services.get(item.service.id) ?? { id: item.service.id, name: item.service.name, count: 0 };
    service.count += 1; services.set(item.service.id, service);
  }
  return res.json({
    rangeDays: query.data.days,
    daily: [...days.values()],
    statusBreakdown: [...status.entries()].map(([name, value]) => ({ name, value })),
    popularServices: [...services.values()].sort((a, b) => b.count - a.count).slice(0, 6)
  });
});

reportsRouter.get("/summary", async (req, res) => {
  const vendorId = req.user?.vendorId;
  if (!vendorId && req.user?.role !== "SUPER_ADMIN") return res.status(403).json({ error: "Missing tenant" });
  if (vendorId) {
    const plan = await requireActiveVendorEntitlements(vendorId).catch(() => null);
    if (!plan) return res.status(403).json({ error: "An active paid subscription is required" });
    if (!plan.entitlements.advancedReports) return res.status(403).json({ error: "Advanced reports are not included in the current subscription" });
  }
  const query = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() }).safeParse(req.query);
  if (!query.success) return res.status(400).json({ error: "Invalid report date range" });
  const startAt = query.data.from || query.data.to ? { ...(query.data.from ? { gte: query.data.from } : {}), ...(query.data.to ? { lte: query.data.to } : {}) } : undefined;
  const where = { ...(req.user?.role === "SUPER_ADMIN" ? {} : req.user?.role === UserRole.STAFF ? { vendorId: vendorId!, staffId: req.user.staffId ?? "__missing_staff__" } : { vendorId: vendorId! }), ...(startAt ? { startAt } : {}) };
  const appointments = await prisma.appointment.findMany({ where, include: { service: true, staff: true, customer: true }, orderBy: { startAt: "asc" } });
  const total = appointments.length;
  const completed = appointments.filter((item) => item.status === AppointmentStatus.COMPLETED).length;
  const cancelled = appointments.filter((item) => item.status === AppointmentStatus.CANCELLED).length;
  const noShows = appointments.filter((item) => item.status === AppointmentStatus.NO_SHOW).length;
  const revenueEstimateCents = appointments.filter((item) => item.status === AppointmentStatus.COMPLETED).reduce((sum, item) => sum + item.service.priceCents, 0);
  const serviceMap = new Map<string, { id: string; name: string; count: number }>();
  const staffMap = new Map<string, { id: string; name: string; total: number; completed: number; noShows: number }>();
  for (const item of appointments) {
    const service = serviceMap.get(item.serviceId) ?? { id: item.serviceId, name: item.service.name, count: 0 };
    service.count += 1; serviceMap.set(item.serviceId, service);
    const staff = staffMap.get(item.staffId) ?? { id: item.staffId, name: item.staff.name, total: 0, completed: 0, noShows: 0 };
    staff.total += 1;
    if (item.status === AppointmentStatus.COMPLETED) staff.completed += 1;
    if (item.status === AppointmentStatus.NO_SHOW) staff.noShows += 1;
    staffMap.set(item.staffId, staff);
  }
  const popularServices = [...serviceMap.values()].sort((a, b) => b.count - a.count).slice(0, 5);
  const staffPerformance = [...staffMap.values()].sort((a, b) => b.completed - a.completed);
  const upcomingAppointments = appointments.filter((item) => item.startAt >= new Date() && item.status !== AppointmentStatus.CANCELLED && item.status !== AppointmentStatus.COMPLETED && item.status !== AppointmentStatus.NO_SHOW).slice(0, 10).map((item) => ({ id: item.id, startAt: item.startAt, customerName: item.customer.name, serviceName: item.service.name, staffName: item.staff.name, status: item.status }));
  return res.json({ total, completed, cancelled, noShows, revenueEstimateCents, popularServices, staffPerformance, upcomingAppointments });
});
