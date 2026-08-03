import { Router } from "express";
import { DomainStatus, PlanVersionStatus, Prisma, SubscriptionStatus, UserRole, VendorStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { entitlementRecord } from "../plans/plans.service.js";
import { receiveProfileImage, receivePromoImage, validatedProfileImage, validatedPromoImage } from "../../utils/image-upload.js";
import { addLiveClient, publishLiveEvent } from "../live/live-events.js";

export const vendorsRouter = Router();

const subscriptionInclude = {
  planVersion: { include: { plan: true, entitlements: true } }
} as const;

const bookingThemeSchema = z.enum(["cobalt", "emerald", "rose", "amber", "graphite"]);
const DEFAULT_PROMO_IMAGE_URL = "https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?auto=format&fit=crop&w=1600&q=80";

function bookingTheme(settings: Prisma.JsonValue | null | undefined) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return "cobalt";
  const value = (settings as Record<string, unknown>).bookingTheme;
  return bookingThemeSchema.safeParse(value).success ? value as z.infer<typeof bookingThemeSchema> : "cobalt";
}

function settingsObject(settings: Prisma.JsonValue | null | undefined): Prisma.JsonObject {
  return settings && typeof settings === "object" && !Array.isArray(settings) ? settings as Prisma.JsonObject : {};
}

vendorsRouter.use(requireAuth);

vendorsRouter.get("/events", (req, res) => {
  const scope = req.user?.role === UserRole.SUPER_ADMIN ? "platform" : req.user?.vendorId;
  if (!scope) return res.status(403).json({ error: "Missing tenant" });
  res.set({ "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
  res.flushHeaders();
  const remove = addLiveClient(scope, res);
  req.on("close", remove);
});

vendorsRouter.get("/live-state", async (req, res) => {
  const vendorId = req.user?.vendorId;
  if (!vendorId) return res.status(403).json({ error: "Missing tenant" });
  const [vendor, appointments, customers, staff, services, branches, messages, notificationLogs, reminderSchedules, activity, calendars, availability] = await Promise.all([
    prisma.vendor.findUnique({ where: { id: vendorId }, select: { updatedAt: true } }),
    prisma.appointment.aggregate({ where: { vendorId }, _max: { updatedAt: true }, _count: true }),
    prisma.customer.aggregate({ where: { vendorId }, _max: { updatedAt: true }, _count: true }),
    prisma.staff.aggregate({ where: { vendorId }, _max: { updatedAt: true }, _count: true }),
    prisma.service.aggregate({ where: { vendorId }, _max: { updatedAt: true }, _count: true }),
    prisma.branch.aggregate({ where: { vendorId }, _max: { updatedAt: true }, _count: true }),
    prisma.messageSetting.findUnique({ where: { vendorId }, select: { updatedAt: true } }),
    prisma.notificationLog.aggregate({ where: { vendorId }, _max: { updatedAt: true }, _count: true }),
    prisma.reminderSchedule.aggregate({ where: { vendorId }, _max: { updatedAt: true }, _count: true }),
    prisma.activityNotification.aggregate({ where: { vendorId }, _max: { createdAt: true }, _count: true }),
    prisma.calendarConnection.aggregate({ where: { vendorId }, _max: { updatedAt: true }, _count: true }),
    Promise.all([
      prisma.workingHour.count({ where: { vendorId } }),
      prisma.breakTime.count({ where: { vendorId } }),
      prisma.holiday.count({ where: { vendorId } })
    ])
  ]);
  const stamp = (value: Date | null | undefined, count?: number) => `${value?.toISOString() ?? "none"}:${count ?? 0}`;
  return res.json({
    vendor: stamp(vendor?.updatedAt),
    appointments: stamp(appointments._max.updatedAt, appointments._count),
    customers: stamp(customers._max.updatedAt, customers._count),
    staff: stamp(staff._max.updatedAt, staff._count),
    services: stamp(services._max.updatedAt, services._count),
    branches: stamp(branches._max.updatedAt, branches._count),
    notifications: [
      stamp(messages?.updatedAt),
      stamp(notificationLogs._max.updatedAt, notificationLogs._count),
      stamp(reminderSchedules._max.updatedAt, reminderSchedules._count)
    ].join("|"),
    activity: stamp(activity._max.createdAt, activity._count),
    calendar: stamp(calendars._max.updatedAt, calendars._count),
    availability: availability.join(":")
  });
});

vendorsRouter.get("/", requireRole(UserRole.SUPER_ADMIN), async (_req, res) => {
  const vendors = await prisma.vendor.findMany({
    include: { _count: { select: { appointments: true, users: true } }, messageSettings: true, customDomains: true, subscription: { include: subscriptionInclude } },
    orderBy: { createdAt: "desc" }
  });
  res.json(vendors.map(({ logoData: _logoData, promoImageData: _promoImageData, messageSettings, ...vendor }) => ({
    ...vendor,
    logoUrl: vendor.logoUpdatedAt ? `/api/public/assets/vendors/${vendor.id}/logo?v=${vendor.logoUpdatedAt.getTime()}` : null,
    promoImageUrl: vendor.promoImageUpdatedAt ? `/api/public/assets/vendors/${vendor.id}/promo?v=${vendor.promoImageUpdatedAt.getTime()}` : DEFAULT_PROMO_IMAGE_URL,
    messageSettings: messageSettings ? { smsEnabled: messageSettings.smsEnabled, encryptedSmsGatewayApiKey: Boolean(messageSettings.encryptedSmsGatewayApiKey) } : null
  })));
});

vendorsRouter.get("/me", async (req, res) => {
  if (!req.user?.vendorId) return res.status(403).json({ error: "Missing tenant" });
  const vendor = await prisma.vendor.findUnique({
    where: { id: req.user.vendorId },
    include: { branches: true, services: true, staff: true, messageSettings: true, customDomains: true, subscription: { include: subscriptionInclude } }
  });
  if (!vendor) return res.status(404).json({ error: "Vendor not found" });
  const { logoData: _logoData, promoImageData: _promoImageData, messageSettings, ...safeVendor } = vendor;
  res.json({
    ...safeVendor,
    bookingTheme: bookingTheme(vendor.settings),
    logoUrl: vendor.logoUpdatedAt ? `/api/public/assets/vendors/${vendor.id}/logo?v=${vendor.logoUpdatedAt.getTime()}` : null,
    promoImageUrl: vendor.promoImageUpdatedAt ? `/api/public/assets/vendors/${vendor.id}/promo?v=${vendor.promoImageUpdatedAt.getTime()}` : DEFAULT_PROMO_IMAGE_URL,
    messageSettings: messageSettings ? { smsEnabled: messageSettings.smsEnabled, encryptedSmsGatewayApiKey: Boolean(messageSettings.encryptedSmsGatewayApiKey) } : null
  });
});

vendorsRouter.patch(
  "/me",
  requireRole(UserRole.VENDOR_ADMIN),
  validateBody(z.object({
    name: z.string().trim().min(2).max(120).optional(),
    slug: z.string().trim().regex(/^[a-z0-9-]{3,80}$/).optional(),
    businessType: z.string().trim().min(2).max(80).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    phone: z.string().trim().min(6).max(30).nullable().optional(),
    email: z.string().email().nullable().optional(),
    timezone: z.string().trim().min(2).max(80).optional(),
    bookingTheme: bookingThemeSchema.optional()
  })),
  async (req, res) => {
    const vendorId = req.user?.vendorId;
    if (!vendorId) return res.status(403).json({ error: "Missing tenant" });
    try {
      const vendor = await prisma.$transaction(async (tx) => {
        const { bookingTheme: nextBookingTheme, ...profile } = req.body;
        const existing = nextBookingTheme ? await tx.vendor.findUnique({ where: { id: vendorId }, select: { settings: true } }) : null;
        const data: Prisma.VendorUpdateInput = {
          ...profile,
          ...(nextBookingTheme ? { settings: { ...settingsObject(existing?.settings), bookingTheme: nextBookingTheme } } : {})
        };
        const updated = await tx.vendor.update({ where: { id: vendorId }, data });
        await tx.auditLog.create({ data: { vendorId, actorUserId: req.user?.id, action: "vendor_profile_updated", entityType: "Vendor", entityId: vendorId, metadata: { fields: Object.keys(req.body) } } });
        return { ...updated, bookingTheme: bookingTheme(updated.settings) };
      });
      publishLiveEvent(vendorId, ["vendor"]);
      return res.json(vendor);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return res.status(409).json({ error: "This booking page slug is already in use" });
      throw error;
    }
  }
);

vendorsRouter.put("/me/logo", requireRole(UserRole.VENDOR_ADMIN), receiveProfileImage, async (req, res) => {
  if (!req.user?.vendorId) return res.status(403).json({ error: "Missing tenant" });
  try {
    const image = validatedProfileImage(req.file);
    const vendor = await prisma.vendor.update({ where: { id: req.user.vendorId }, data: { logoData: image.data, logoMimeType: image.mimeType, logoUpdatedAt: image.updatedAt }, select: { id: true, logoUpdatedAt: true } });
    publishLiveEvent(req.user.vendorId, ["vendor"]);
    return res.json({ logoUrl: `/api/public/assets/vendors/${vendor.id}/logo?v=${vendor.logoUpdatedAt!.getTime()}` });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Could not upload logo" });
  }
});

vendorsRouter.delete("/me/logo", requireRole(UserRole.VENDOR_ADMIN), async (req, res) => {
  if (!req.user?.vendorId) return res.status(403).json({ error: "Missing tenant" });
  await prisma.vendor.update({ where: { id: req.user.vendorId }, data: { logoData: null, logoMimeType: null, logoUpdatedAt: null } });
  publishLiveEvent(req.user.vendorId, ["vendor"]);
  return res.sendStatus(204);
});

vendorsRouter.put("/me/promo-image", requireRole(UserRole.VENDOR_ADMIN), receivePromoImage, async (req, res) => {
  if (!req.user?.vendorId) return res.status(403).json({ error: "Missing tenant" });
  try {
    const image = validatedPromoImage(req.file);
    const vendor = await prisma.vendor.update({ where: { id: req.user.vendorId }, data: { promoImageData: image.data, promoImageMimeType: image.mimeType, promoImageUpdatedAt: image.updatedAt }, select: { id: true, promoImageUpdatedAt: true } });
    publishLiveEvent(req.user.vendorId, ["vendor"]);
    return res.json({ promoImageUrl: `/api/public/assets/vendors/${vendor.id}/promo?v=${vendor.promoImageUpdatedAt!.getTime()}` });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Could not upload promotional image" });
  }
});

vendorsRouter.delete("/me/promo-image", requireRole(UserRole.VENDOR_ADMIN), async (req, res) => {
  if (!req.user?.vendorId) return res.status(403).json({ error: "Missing tenant" });
  await prisma.vendor.update({ where: { id: req.user.vendorId }, data: { promoImageData: null, promoImageMimeType: null, promoImageUpdatedAt: null } });
  publishLiveEvent(req.user.vendorId, ["vendor"]);
  return res.sendStatus(204);
});

vendorsRouter.post(
  "/",
  requireRole(UserRole.SUPER_ADMIN),
  validateBody(z.object({
    name: z.string().min(2),
    slug: z.string().regex(/^[a-z0-9-]+$/),
    businessType: z.string().min(2),
    phone: z.string().optional(),
    email: z.string().email().optional(),
    timezone: z.string().optional()
  })),
  async (req, res) => {
    const planVersion = await prisma.planVersion.findFirst({
      where: { plan: { code: "STANDARD", active: true }, status: PlanVersionStatus.PUBLISHED },
      orderBy: { version: "desc" }
    });
    if (!planVersion) return res.status(409).json({ error: "Publish a Standard plan before creating vendors" });
    const vendor = await prisma.vendor.create({
      data: {
        ...req.body,
        subscription: { create: { planVersionId: planVersion.id, status: SubscriptionStatus.PENDING, provider: "manual" } }
      },
      include: { subscription: { include: subscriptionInclude } }
    });
    res.status(201).json(vendor);
  }
);

vendorsRouter.patch(
  "/:id/plan",
  requireRole(UserRole.SUPER_ADMIN),
  validateBody(z.object({ planId: z.string().min(1) })),
  async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.vendor.findUnique({ where: { id }, include: { subscription: true } });
    if (!existing) return res.status(404).json({ error: "Vendor not found" });
    const plan = await prisma.subscriptionPlan.findFirst({
      where: { id: req.body.planId, active: true },
      include: { versions: { where: { status: PlanVersionStatus.PUBLISHED }, orderBy: { version: "desc" }, take: 1, include: { entitlements: true } } }
    });
    const version = plan?.versions[0];
    if (!plan || !version) return res.status(404).json({ error: "Active published plan not found" });
    const entitlements = entitlementRecord(version.entitlements);
    const subscription = await prisma.$transaction(async (tx) => {
      const updated = await tx.vendorSubscription.upsert({
        where: { vendorId: id },
        update: { planVersionId: version.id, status: SubscriptionStatus.ACTIVE, provider: "manual", cancelAtPeriodEnd: false },
        create: { vendorId: id, planVersionId: version.id, status: SubscriptionStatus.ACTIVE, provider: "manual" },
        include: { planVersion: { include: { plan: true, entitlements: true } } }
      });
      if (!entitlements.customDomain) {
        await tx.vendorDomain.updateMany({ where: { vendorId: id }, data: { status: DomainStatus.DISABLED } });
      }
      if (!entitlements.calendarSync) await tx.calendarConnection.updateMany({ where: { vendorId: id }, data: { syncEnabled: false } });
      if (!entitlements.smsAutomation) await tx.messageSetting.updateMany({ where: { vendorId: id }, data: { smsEnabled: false } });
      await tx.auditLog.create({
        data: { vendorId: id, actorUserId: req.user?.id, action: "vendor_plan_changed", entityType: "VendorSubscription", entityId: updated.id, metadata: { planId: plan.id, planCode: plan.code, version: version.version } }
      });
      return updated;
    });
    publishLiveEvent(id, ["vendor", "billing", "calendar", "notifications"]);
    publishLiveEvent("platform", ["users", "plans"]);
    return res.json({ id, subscription });
  }
);

vendorsRouter.patch(
  "/:id/status",
  requireRole(UserRole.SUPER_ADMIN),
  validateBody(z.object({ status: z.enum(["PENDING_REVIEW", "ACTIVE", "INACTIVE", "SUSPENDED", "TRIAL"]) })),
  async (req, res) => {
    const id = String(req.params.id);
    const existing = await prisma.vendor.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Vendor not found" });
    if (req.body.status === VendorStatus.ACTIVE && !existing.phoneVerifiedAt) {
      return res.status(409).json({ error: "Vendor phone must be verified by OTP before activation." });
    }
    const vendor = await prisma.$transaction(async (tx) => {
      const updated = await tx.vendor.update({ where: { id }, data: { status: req.body.status } });
      if (req.body.status === VendorStatus.ACTIVE) {
        await tx.user.updateMany({
          where: { vendorId: id, role: UserRole.VENDOR_ADMIN },
          data: { active: true }
        });
      }
      if ([VendorStatus.SUSPENDED, VendorStatus.INACTIVE].includes(req.body.status)) {
        await tx.user.updateMany({
          where: { vendorId: id, role: { not: UserRole.CUSTOMER } },
          data: { active: false }
        });
      }
      await tx.auditLog.create({
        data: {
          vendorId: id,
          actorUserId: req.user?.id,
          action: "vendor_status_changed",
          entityType: "Vendor",
          entityId: id,
          metadata: { status: req.body.status }
        }
      });
      return updated;
    });
    publishLiveEvent(id, ["vendor"]);
    publishLiveEvent("platform", ["users"]);
    res.json(vendor);
  }
);
