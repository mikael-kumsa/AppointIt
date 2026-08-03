import { Router } from "express";
import rateLimit from "express-rate-limit";
import { AppointmentSource, DomainStatus, PaymentInvoiceStatus, PlanVersionStatus, Prisma, SubscriptionStatus, UserRole, VendorStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../db.js";
import { validateBody } from "../../middleware/validate.js";
import { listAvailableSlots } from "../availability/availability.service.js";
import { cancelAppointment, createAppointment, rescheduleAppointment } from "../appointments/appointments.service.js";
import { customerManagementCapabilities, managedAppointment, signAppointmentManagementToken } from "../appointments/appointment-management.service.js";
import { hashPassword } from "../auth/auth.service.js";
import { normalizeHostname } from "../../utils/hostname.js";
import { activeCustomDomainSubscriptionWhere } from "../plans/plans.service.js";
import { env } from "../../config/env.js";
import { newPaymentToken, paymentInvoiceExpiry, paymentTokenHash } from "../payments/payments.service.js";

export const publicRouter = Router();
const activeVendorStatuses: VendorStatus[] = [VendorStatus.ACTIVE, VendorStatus.TRIAL];
const resumableVendorStatuses: VendorStatus[] = [VendorStatus.PENDING_REVIEW, VendorStatus.ACTIVE, VendorStatus.TRIAL];
const DEFAULT_PROMO_IMAGE_URL = "https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?auto=format&fit=crop&w=1600&q=80";
const publicVendorSelect = {
  id: true,
  name: true,
  slug: true,
  businessType: true,
  description: true,
  timezone: true,
  settings: true,
  logoUpdatedAt: true,
  promoImageUpdatedAt: true,
  branches: { where: { active: true }, select: { id: true, name: true, address: true, phone: true } },
  services: { where: { active: true }, select: { id: true, name: true, description: true, category: true, priceCents: true, durationMinutes: true } },
  staff: {
    where: { active: true },
    select: {
      id: true,
      name: true,
      roleTitle: true,
      branchId: true,
      profileImageUpdatedAt: true,
      services: { select: { serviceId: true } }
    }
  }
} as const;

const activeHostedVendorWhere = {
  status: { in: activeVendorStatuses },
  subscription: { status: SubscriptionStatus.ACTIVE }
};
const resumableSubscriptionStatuses: SubscriptionStatus[] = [SubscriptionStatus.PENDING, SubscriptionStatus.CANCELLED, SubscriptionStatus.EXPIRED];

function serializePublicVendor(vendor: Prisma.VendorGetPayload<{ select: typeof publicVendorSelect }>) {
  const settings = vendor.settings && typeof vendor.settings === "object" && !Array.isArray(vendor.settings) ? vendor.settings as Record<string, unknown> : {};
  const bookingTheme = typeof settings.bookingTheme === "string" && ["cobalt", "emerald", "rose", "amber", "graphite"].includes(settings.bookingTheme) ? settings.bookingTheme : "cobalt";
  return {
    ...vendor,
    bookingTheme,
    settings: undefined,
    logoUrl: vendor.logoUpdatedAt ? `/api/public/assets/vendors/${vendor.id}/logo?v=${vendor.logoUpdatedAt.getTime()}` : null,
    promoImageUrl: vendor.promoImageUpdatedAt ? `/api/public/assets/vendors/${vendor.id}/promo?v=${vendor.promoImageUpdatedAt.getTime()}` : DEFAULT_PROMO_IMAGE_URL,
    staff: vendor.staff.map((member) => ({
      ...member,
      profileImageUrl: member.profileImageUpdatedAt ? `/api/public/assets/staff/${member.id}/photo?v=${member.profileImageUpdatedAt.getTime()}` : null
    }))
  };
}

function customDomainVendorWhere(hostname: string) {
  return {
    status: { in: activeVendorStatuses },
    subscription: activeCustomDomainSubscriptionWhere,
    customDomains: { some: { hostname, status: DomainStatus.ACTIVE } }
  };
}

publicRouter.use(rateLimit({ windowMs: 60_000, limit: 60 }));

function managedAppointmentResponse(appointment: Awaited<ReturnType<typeof managedAppointment>>) {
  return {
    id: appointment.id,
    startAt: appointment.startAt,
    endAt: appointment.endAt,
    status: appointment.status,
    vendor: { name: appointment.vendor.name, timezone: appointment.vendor.timezone },
    branch: { id: appointment.branch.id, name: appointment.branch.name, address: appointment.branch.address },
    service: { id: appointment.service.id, name: appointment.service.name, durationMinutes: appointment.service.durationMinutes },
    staff: { id: appointment.staff.id, name: appointment.staff.name, roleTitle: appointment.staff.roleTitle },
    customer: { name: appointment.customer.name },
    capabilities: customerManagementCapabilities(appointment)
  };
}

publicRouter.get("/appointments/manage", async (req, res) => {
  try {
    const token = z.string().min(20).parse(req.query.token);
    return res.json(managedAppointmentResponse(await managedAppointment(token)));
  } catch (error) {
    return res.status(401).json({ error: error instanceof Error ? error.message : "Invalid booking management link" });
  }
});

publicRouter.get("/appointments/manage/slots", async (req, res) => {
  try {
    const query = z.object({ token: z.string().min(20), date: z.coerce.date(), staffId: z.string().optional() }).parse(req.query);
    const appointment = await managedAppointment(query.token);
    const capabilities = customerManagementCapabilities(appointment);
    if (!capabilities.canReschedule) return res.status(409).json({ error: "This appointment can no longer be rescheduled online" });
    return res.json(await listAvailableSlots(prisma, appointment.vendorId, appointment.branchId, appointment.serviceId, query.date, query.staffId));
  } catch (error) {
    return res.status(401).json({ error: error instanceof Error ? error.message : "Could not load available times" });
  }
});

publicRouter.post("/appointments/manage/reschedule", validateBody(z.object({ token: z.string().min(20), startAt: z.coerce.date(), staffId: z.string().optional() })), async (req, res) => {
  try {
    const current = await managedAppointment(req.body.token);
    if (!customerManagementCapabilities(current).canReschedule) return res.status(409).json({ error: "This appointment can no longer be rescheduled online" });
    await rescheduleAppointment(current.vendorId, current.id, req.body.startAt, req.body.staffId, "customer");
    const updated = await managedAppointment(req.body.token);
    return res.json({ ...managedAppointmentResponse(updated), managementToken: signAppointmentManagementToken(updated) });
  } catch (error) {
    return res.status(409).json({ error: error instanceof Error ? error.message : "Could not reschedule appointment" });
  }
});

publicRouter.post("/appointments/manage/cancel", validateBody(z.object({ token: z.string().min(20), reason: z.string().max(500).optional() })), async (req, res) => {
  try {
    const current = await managedAppointment(req.body.token);
    if (!customerManagementCapabilities(current).canCancel) return res.status(409).json({ error: "This appointment can no longer be cancelled online" });
    await cancelAppointment(current.vendorId, current.id, req.body.reason, "customer");
    return res.json(managedAppointmentResponse(await managedAppointment(req.body.token)));
  } catch (error) {
    return res.status(409).json({ error: error instanceof Error ? error.message : "Could not cancel appointment" });
  }
});

publicRouter.get("/assets/vendors/:id/logo", async (req, res) => {
  const vendor = await prisma.vendor.findFirst({ where: { id: String(req.params.id), ...activeHostedVendorWhere }, select: { logoData: true, logoMimeType: true, logoUpdatedAt: true } });
  if (!vendor?.logoData || !vendor.logoMimeType) return res.sendStatus(404);
  res.set({ "content-type": vendor.logoMimeType, "cache-control": "public, max-age=86400, immutable" });
  return res.send(vendor.logoData);
});

publicRouter.get("/assets/vendors/:id/promo", async (req, res) => {
  const vendor = await prisma.vendor.findFirst({ where: { id: String(req.params.id), ...activeHostedVendorWhere }, select: { promoImageData: true, promoImageMimeType: true, promoImageUpdatedAt: true } });
  if (!vendor?.promoImageData || !vendor.promoImageMimeType) return res.sendStatus(404);
  res.set({ "content-type": vendor.promoImageMimeType, "cache-control": "public, max-age=86400, immutable" });
  return res.send(vendor.promoImageData);
});

publicRouter.get("/assets/staff/:id/photo", async (req, res) => {
  const staff = await prisma.staff.findFirst({ where: { id: String(req.params.id), active: true, vendor: activeHostedVendorWhere }, select: { profileImageData: true, profileImageMimeType: true } });
  if (!staff?.profileImageData || !staff.profileImageMimeType) return res.sendStatus(404);
  res.set({ "content-type": staff.profileImageMimeType, "cache-control": "public, max-age=86400, immutable" });
  return res.send(staff.profileImageData);
});

publicRouter.post(
  "/vendor-signup",
  validateBody(z.object({
    ownerName: z.string().min(2),
    ownerEmail: z.string().email(),
    ownerPhone: z.string().min(6),
    planCode: z.string().regex(/^[A-Z][A-Z0-9_]{2,29}$/).optional(),
    password: z.string().min(8),
    businessName: z.string().min(2),
    businessType: z.string().min(2),
    slug: z.string().regex(/^[a-z0-9-]+$/),
    branchName: z.string().min(2),
    branchAddress: z.string().min(2),
    service: z.object({
      name: z.string().min(2),
      category: z.string().min(2),
      priceCents: z.number().int().nonnegative(),
      durationMinutes: z.number().int().min(5).max(480),
      bufferAfterMinutes: z.number().int().min(0).max(120).default(0)
    }),
    provider: z.object({
      name: z.string().min(2),
      roleTitle: z.string().min(2),
      phone: z.string().min(6).optional(),
      email: z.string().email().optional()
      ,smsOptIn: z.boolean().default(false)
    }),
    timezone: z.string().default("Africa/Addis_Ababa")
  })),
  async (req, res) => {
    try {
      const selectedPlan = await prisma.subscriptionPlan.findFirst({
        where: { code: req.body.planCode ?? "STANDARD", active: true, isPublic: true },
        include: { versions: { where: { status: PlanVersionStatus.PUBLISHED }, orderBy: { version: "desc" }, take: 1 } }
      });
      const selectedVersion = selectedPlan?.versions[0];
      if (!selectedPlan || !selectedVersion) return res.status(409).json({ error: "Selected subscription plan is unavailable" });
      if (selectedVersion.currency !== "ETB" || selectedVersion.monthlyPriceCents === null) {
        return res.status(409).json({ error: "This plan requires a custom quote. Please contact AppointIt sales." });
      }
      const monthlyPriceCents = selectedVersion.monthlyPriceCents;
      const passwordHash = await hashPassword(req.body.password);
      const paymentToken = newPaymentToken();

      const existingOwner = await prisma.user.findUnique({
        where: { email: req.body.ownerEmail },
        select: {
          id: true,
          email: true,
          role: true,
          vendor: {
            select: {
              id: true,
              status: true,
              subscription: { select: { status: true } },
              paymentInvoices: {
                where: { status: { in: [PaymentInvoiceStatus.PAID, PaymentInvoiceStatus.REVIEW] } },
                select: { id: true, status: true },
                orderBy: { createdAt: "desc" },
                take: 1
              }
            }
          }
        }
      });
      if (existingOwner) {
        const subscriptionStatus = existingOwner.vendor?.subscription?.status;
        const reviewOrPaidInvoice = existingOwner.vendor?.paymentInvoices[0];
          const canResumePayment = existingOwner.role === UserRole.VENDOR_ADMIN
          && existingOwner.vendor
          && resumableVendorStatuses.includes(existingOwner.vendor.status)
          && subscriptionStatus
          && resumableSubscriptionStatuses.includes(subscriptionStatus)
          && !reviewOrPaidInvoice;
        if (!canResumePayment) {
          const message = reviewOrPaidInvoice?.status === PaymentInvoiceStatus.REVIEW
            ? "Your payment proof is already under review. Please wait for approval or contact support."
            : "An account with this owner email already exists. Please log in or use another email.";
          return res.status(409).json({ error: message });
        }
        const invoice = await prisma.$transaction(async (tx) => {
          await tx.paymentInvoice.updateMany({
            where: { vendorId: existingOwner.vendor!.id, status: { in: [PaymentInvoiceStatus.PENDING, PaymentInvoiceStatus.SUBMITTED] } },
            data: { status: PaymentInvoiceStatus.CANCELLED }
          });
          await tx.vendorSubscription.update({
            where: { vendorId: existingOwner.vendor!.id },
            data: { planVersionId: selectedVersion.id, status: SubscriptionStatus.PENDING, provider: "telebirr_sms" }
          });
          const created = await tx.paymentInvoice.create({
            data: {
              vendorId: existingOwner.vendor!.id,
              planVersionId: selectedVersion.id,
              accessTokenHash: paymentTokenHash(paymentToken),
              amountCents: monthlyPriceCents,
              currency: selectedVersion.currency,
              destinationPhone: env.TELEBIRR_PAYMENT_PHONE,
              expiresAt: paymentInvoiceExpiry()
            }
          });
          await tx.auditLog.create({
            data: {
              vendorId: existingOwner.vendor!.id,
              actorUserId: existingOwner.id,
              action: "vendor_signup_payment_resumed",
              entityType: "PaymentInvoice",
              entityId: created.id,
              metadata: { ownerEmail: req.body.ownerEmail, subscriptionPlanCode: selectedPlan.code, planVersionId: selectedVersion.id }
            }
          });
          return created;
        });
        return res.status(200).json({
          vendorId: existingOwner.vendor!.id,
          ownerEmail: existingOwner.email,
          status: existingOwner.vendor!.status,
          payment: { invoiceId: invoice.id, token: paymentToken },
          resumed: true,
          message: "Your business signup is already started. Complete the Telebirr payment to continue."
        });
      }

      const vendor = await prisma.$transaction(async (tx) => {
        const createdVendor = await tx.vendor.create({
          data: {
            name: req.body.businessName,
            slug: req.body.slug,
            businessType: req.body.businessType,
            phone: req.body.ownerPhone,
            email: req.body.ownerEmail,
            timezone: req.body.timezone,
            status: VendorStatus.PENDING_REVIEW,
            subscription: {
              create: { planVersionId: selectedVersion.id, status: SubscriptionStatus.PENDING, provider: "telebirr_sms" }
            }
          }
        });

        const branch = await tx.branch.create({
          data: {
            vendorId: createdVendor.id,
            name: req.body.branchName,
            address: req.body.branchAddress,
            phone: req.body.ownerPhone,
            timezone: req.body.timezone
          }
        });

        const service = await tx.service.create({
          data: {
            vendorId: createdVendor.id,
            name: req.body.service.name,
            category: req.body.service.category,
            priceCents: req.body.service.priceCents,
            durationMinutes: req.body.service.durationMinutes,
            bufferAfterMinutes: req.body.service.bufferAfterMinutes
          }
        });

        await tx.staff.create({
          data: {
            vendorId: createdVendor.id,
            branchId: branch.id,
            name: req.body.provider.name,
            roleTitle: req.body.provider.roleTitle,
            phone: req.body.provider.phone || req.body.ownerPhone,
            email: req.body.provider.email || undefined,
            services: { create: [{ serviceId: service.id }] }
          }
        });

        const owner = await tx.user.create({
          data: {
            vendorId: createdVendor.id,
            name: req.body.ownerName,
            email: req.body.ownerEmail,
            phone: req.body.ownerPhone,
            passwordHash,
            role: UserRole.VENDOR_ADMIN,
            active: true
          }
        });

        await tx.workingHour.createMany({
          data: [1, 2, 3, 4, 5, 6].map((weekday) => ({
            vendorId: createdVendor.id,
            weekday,
            startTime: "09:00",
            endTime: "17:00"
          }))
        });

        const paymentInvoice = await tx.paymentInvoice.create({
          data: {
            vendorId: createdVendor.id,
            planVersionId: selectedVersion.id,
            accessTokenHash: paymentTokenHash(paymentToken),
            amountCents: monthlyPriceCents,
            currency: selectedVersion.currency,
            destinationPhone: env.TELEBIRR_PAYMENT_PHONE,
            expiresAt: paymentInvoiceExpiry()
          }
        });

        await tx.auditLog.create({
          data: {
            vendorId: createdVendor.id,
            action: "vendor_signup_submitted",
            entityType: "Vendor",
            entityId: createdVendor.id,
            metadata: {
              ownerEmail: req.body.ownerEmail,
              branchId: branch.id,
              serviceId: service.id,
              ownerUserId: owner.id,
              subscriptionPlanCode: selectedPlan.code,
              starterWorkspaceCreated: true
            }
          }
        });

        return { vendor: createdVendor, owner, paymentInvoice };
      });

      res.status(201).json({
        vendorId: vendor.vendor.id,
        ownerEmail: vendor.owner.email,
        status: vendor.vendor.status,
        payment: { invoiceId: vendor.paymentInvoice.id, token: paymentToken },
        message: "Business workspace created. Complete the Telebirr payment, then verify the owner phone number."
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const target = Array.isArray(error.meta?.target) ? error.meta.target.join(", ") : "unique field";
        if (target.includes("email")) {
          return res.status(409).json({ error: "An account with this owner email already exists. Please log in or use another email." });
        }
        if (target.includes("slug")) {
          return res.status(409).json({ error: "This booking page slug is already taken. Please choose another slug." });
        }
        return res.status(409).json({ error: "This signup conflicts with an existing account." });
      }
      throw error;
    }
  }
);

publicRouter.get("/vendors/:slug", async (req, res) => {
  const vendor = await prisma.vendor.findFirst({
    where: { slug: req.params.slug, ...activeHostedVendorWhere },
    select: publicVendorSelect
  });
  if (!vendor) return res.status(404).json({ error: "Booking page not found" });
  return res.json(serializePublicVendor(vendor));
});

publicRouter.get("/domains/authorize", async (req, res) => {
  const hostname = normalizeHostname(typeof req.query.domain === "string" ? req.query.domain : "");
  if (!hostname) return res.sendStatus(404);
  const domain = await prisma.vendorDomain.findFirst({ where: { hostname, status: DomainStatus.ACTIVE, vendor: { status: { in: activeVendorStatuses }, subscription: activeCustomDomainSubscriptionWhere } }, select: { id: true } });
  return domain ? res.sendStatus(204) : res.sendStatus(404);
});

publicRouter.get("/vendors/:slug/slots", async (req, res) => {
  const query = z.object({
    branchId: z.string(),
    serviceId: z.string(),
    staffId: z.string().optional(),
    date: z.coerce.date()
  }).safeParse(req.query);
  if (!query.success) return res.status(400).json({ error: "Invalid query" });

  const vendor = await prisma.vendor.findFirst({ where: { slug: req.params.slug, ...activeHostedVendorWhere } });
  if (!vendor) return res.status(404).json({ error: "Booking page not found" });
  const slots = await listAvailableSlots(prisma, vendor.id, query.data.branchId, query.data.serviceId, query.data.date, query.data.staffId);
  return res.json(slots);
});

publicRouter.post(
  "/vendors/:slug/book",
  validateBody(z.object({
    branchId: z.string(),
    serviceId: z.string(),
    staffId: z.string().optional(),
    startAt: z.coerce.date(),
    customer: z.object({
      name: z.string().min(2),
      phone: z.string().min(6),
      email: z.string().email().optional(),
      smsOptIn: z.boolean().default(false)
    })
  })),
  async (req, res) => {
    try {
      const vendor = await prisma.vendor.findFirst({ where: { slug: String(req.params.slug), ...activeHostedVendorWhere } });
      if (!vendor) return res.status(404).json({ error: "Booking page not found" });
      const appointment = await createAppointment({ ...req.body, vendorId: vendor.id, source: AppointmentSource.PUBLIC_BOOKING });
      return res.status(201).json({ ...appointment, managementToken: signAppointmentManagementToken(appointment) });
    } catch (error) {
      return res.status(409).json({ error: error instanceof Error ? error.message : "Booking failed" });
    }
  }
);

publicRouter.get("/domains/:hostname", async (req, res) => {
  const hostname = normalizeHostname(String(req.params.hostname));
  if (!hostname) return res.status(404).json({ error: "Booking page not found" });
  const vendor = await prisma.vendor.findFirst({ where: customDomainVendorWhere(hostname), select: publicVendorSelect });
  if (!vendor) return res.status(404).json({ error: "Booking page not found" });
  return res.json(serializePublicVendor(vendor));
});

publicRouter.get("/domains/:hostname/slots", async (req, res) => {
  const hostname = normalizeHostname(String(req.params.hostname));
  const query = z.object({
    branchId: z.string(),
    serviceId: z.string(),
    staffId: z.string().optional(),
    date: z.coerce.date()
  }).safeParse(req.query);
  if (!hostname || !query.success) return res.status(400).json({ error: "Invalid request" });
  const vendor = await prisma.vendor.findFirst({ where: customDomainVendorWhere(hostname), select: { id: true } });
  if (!vendor) return res.status(404).json({ error: "Booking page not found" });
  return res.json(await listAvailableSlots(prisma, vendor.id, query.data.branchId, query.data.serviceId, query.data.date, query.data.staffId));
});

publicRouter.post(
  "/domains/:hostname/book",
  validateBody(z.object({
    branchId: z.string(),
    serviceId: z.string(),
    staffId: z.string().optional(),
    startAt: z.coerce.date(),
    customer: z.object({
      name: z.string().min(2),
      phone: z.string().min(6),
      email: z.string().email().optional(),
      smsOptIn: z.boolean().default(false)
    })
  })),
  async (req, res) => {
    const hostname = normalizeHostname(String(req.params.hostname));
    if (!hostname) return res.status(404).json({ error: "Booking page not found" });
    try {
      const vendor = await prisma.vendor.findFirst({ where: customDomainVendorWhere(hostname), select: { id: true } });
      if (!vendor) return res.status(404).json({ error: "Booking page not found" });
      const appointment = await createAppointment({ ...req.body, vendorId: vendor.id, source: AppointmentSource.PUBLIC_BOOKING });
      return res.status(201).json({ ...appointment, managementToken: signAppointmentManagementToken(appointment) });
    } catch (error) {
      return res.status(409).json({ error: error instanceof Error ? error.message : "Booking failed" });
    }
  }
);
