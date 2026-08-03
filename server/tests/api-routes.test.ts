import express from "express";
import request from "supertest";
import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppointmentSource, DomainStatus, PaymentInvoiceStatus, PhoneChallengePurpose, SubscriptionStatus, UserRole, VendorStatus } from "@prisma/client";

vi.mock("../src/db.js", () => ({
  prisma: {
    vendor: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn()
    },
    vendorDomain: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn()
    },
    branch: {
      count: vi.fn(),
      create: vi.fn()
    },
    service: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn()
    },
    staff: {
      count: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn()
    },
    subscriptionPlan: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn()
    },
    planVersion: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn()
    },
    vendorSubscription: {
      findUnique: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn()
    },
    paymentInvoice: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn()
    },
    workingHour: {
      createMany: vi.fn()
    },
    staffInvite: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn()
    },
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn()
    },
    authRefreshToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn()
    },
    passwordResetToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn()
    },
    auditLog: {
      create: vi.fn()
    },
    appointment: {
      count: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn()
    },
    appointmentHistory: {
      create: vi.fn()
    },
    $transaction: vi.fn()
  }
}));

vi.mock("../src/middleware/auth.js", async () => {
  const actual = await vi.importActual<typeof import("../src/middleware/auth.js")>("../src/middleware/auth.js");
  return {
    ...actual,
    requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      req.user = currentUser;
      next();
    },
    requireRole: (...roles: UserRole[]) => (req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: "Insufficient permissions" });
      next();
    }
  };
});

vi.mock("../src/modules/appointments/appointments.service.js", () => ({
  createAppointment: vi.fn(),
  cancelAppointment: vi.fn(),
  completeAppointment: vi.fn(),
  markNoShowAppointment: vi.fn(),
  rescheduleAppointment: vi.fn()
}));

vi.mock("../src/modules/telegram/telegram-login.service.js", () => ({
  startTelegramLogin: vi.fn(),
  completeTelegramLogin: vi.fn()
}));

vi.mock("../src/modules/auth/phone-verification.service.js", () => ({
  startPhoneVerification: vi.fn(),
  completePhoneVerification: vi.fn(),
  resendPhoneVerification: vi.fn(),
  PhoneVerificationError: class PhoneVerificationError extends Error {}
}));

vi.mock("../src/modules/notifications/email.service.js", () => ({
  isSmtpConfigured: vi.fn(() => true),
  sendPlatformEmail: vi.fn(async () => ({
    messageId: "smtp-message-1",
    accepted: ["admin@vendor.test"],
    rejected: [],
    response: "250 OK"
  }))
}));

vi.mock("../src/modules/notifications/notification.queue.js", () => ({
  enqueueAppointmentNotification: vi.fn(async () => ({ queued: true, jobId: "manual-job-1" })),
  enqueueAppointmentNotifications: vi.fn(),
  scheduleAppointmentReminders: vi.fn(),
  cancelAppointmentReminderJobs: vi.fn(),
  scheduleAppointmentFollowUp: vi.fn()
}));

vi.mock("../src/modules/domains/custom-domain.provider.js", () => ({
  customDomainProviderReady: vi.fn(() => true),
  provisionCustomDomain: vi.fn(async () => ({ provider: "manual", status: "PENDING", sslStatus: "pending", verificationRecords: [] })),
  refreshProvisionedDomain: vi.fn(),
  verifyManualDomain: vi.fn(),
  removeProvisionedDomain: vi.fn()
}));

vi.mock("../src/modules/auth/auth.service.js", async () => {
  const actual = await vi.importActual<typeof import("../src/modules/auth/auth.service.js")>("../src/modules/auth/auth.service.js");
  return {
    ...actual,
    login: vi.fn(),
    getAuthContext: vi.fn(),
    hashPassword: vi.fn(async () => "hashed-password")
  };
});

import { prisma } from "../src/db.js";
import { authRouter } from "../src/modules/auth/auth.routes.js";
import { vendorsRouter } from "../src/modules/vendors/vendors.routes.js";
import { appointmentsRouter } from "../src/modules/appointments/appointments.routes.js";
import { staffRouter } from "../src/modules/staff/staff.routes.js";
import { publicRouter } from "../src/modules/public/public.routes.js";
import { telegramRouter } from "../src/modules/telegram/telegram.routes.js";
import { domainsRouter } from "../src/modules/domains/domains.routes.js";
import { plansRouter } from "../src/modules/plans/plans.routes.js";
import { branchesRouter } from "../src/modules/vendors/branches.routes.js";
import { servicesRouter } from "../src/modules/services/services.routes.js";
import { login } from "../src/modules/auth/auth.service.js";
import { createAppointment } from "../src/modules/appointments/appointments.service.js";
import { completeAppointment, markNoShowAppointment } from "../src/modules/appointments/appointments.service.js";
import { completeTelegramLogin } from "../src/modules/telegram/telegram-login.service.js";
import { startPhoneVerification } from "../src/modules/auth/phone-verification.service.js";
import { sendPlatformEmail } from "../src/modules/notifications/email.service.js";
import { enqueueAppointmentNotification } from "../src/modules/notifications/notification.queue.js";

let currentUser: Express.Request["user"];

function testApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  app.use("/api/vendors", vendorsRouter);
  app.use("/api/appointments", appointmentsRouter);
  app.use("/api/staff", staffRouter);
  app.use("/api/public", publicRouter);
  app.use("/api/telegram", telegramRouter);
  app.use("/api/domains", domainsRouter);
  app.use("/api/plans", plansRouter);
  app.use("/api/branches", branchesRouter);
  app.use("/api/services", servicesRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  currentUser = {
    id: "super-user",
    vendorId: null,
    role: UserRole.SUPER_ADMIN,
    name: "Super Admin",
    email: "super@appointit.local"
  };
});

function entitlementRows(customDomain: boolean) {
  return [
    { key: "maxBranches", value: customDomain ? 5 : 1 },
    { key: "maxStaff", value: customDomain ? 25 : 5 },
    { key: "customDomain", value: customDomain },
    { key: "calendarSync", value: true },
    { key: "smsAutomation", value: true },
    { key: "advancedReports", value: customDomain },
    { key: "auditRetentionDays", value: customDomain ? 365 : 30 },
    { key: "prioritySupport", value: customDomain },
    { key: "customIntegrations", value: false }
  ];
}

function subscriptionRecord(customDomain: boolean) {
  return {
    id: "subscription-1",
    vendorId: "vendor-1",
    status: SubscriptionStatus.ACTIVE,
    provider: "manual",
    planVersion: {
      id: customDomain ? "premium-v1" : "standard-v1",
      version: 1,
      plan: { id: customDomain ? "premium" : "standard", code: customDomain ? "PREMIUM" : "STANDARD", name: customDomain ? "Premium" : "Standard" },
      entitlements: entitlementRows(customDomain)
    }
  };
}

describe("API route behavior", () => {
  it("publishes the active plan catalogue without authentication", async () => {
    vi.mocked(prisma.subscriptionPlan.findMany).mockResolvedValue([{
      id: "standard",
      code: "STANDARD",
      name: "Standard",
      description: "Core paid appointment management",
      displayOrder: 1,
      active: true,
      isPublic: true,
      versions: [{
        id: "standard-v1",
        version: 1,
        status: "PUBLISHED",
        currency: "ETB",
        monthlyPriceCents: 100000,
        annualPriceCents: 1000000,
        trialDays: 0,
        publishedAt: new Date(),
        entitlements: entitlementRows(false),
        _count: { subscriptions: 2 }
      }]
    }] as any);

    currentUser = undefined;
    const response = await request(testApp()).get("/api/plans/public");

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store, max-age=0");
    expect(response.body[0]).toMatchObject({ code: "STANDARD", currentVersion: { monthlyPriceCents: 100000, subscriberCount: 2 } });
  });

  it("lets super admins create a configurable paid plan", async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => callback(prisma));
    vi.mocked(prisma.subscriptionPlan.create).mockResolvedValue({
      id: "growth",
      code: "GROWTH",
      name: "Growth",
      description: "A configurable paid plan for growing teams.",
      displayOrder: 4,
      active: true,
      isPublic: true,
      versions: [{ id: "growth-v1", version: 1, status: "PUBLISHED", currency: "ETB", monthlyPriceCents: 400000, annualPriceCents: null, trialDays: 0, publishedAt: new Date(), entitlements: entitlementRows(true), _count: { subscriptions: 0 } }]
    } as any);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({ id: "audit-1" } as any);

    const response = await request(testApp()).post("/api/plans").send({
      code: "GROWTH",
      name: "Growth",
      description: "A configurable paid plan for growing teams.",
      displayOrder: 4,
      isPublic: true,
      version: { currency: "ETB", monthlyPriceCents: 400000, annualPriceCents: null, trialDays: 0, entitlements: Object.fromEntries(entitlementRows(true).map((row) => [row.key, row.value])) }
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ code: "GROWTH", currentVersion: { monthlyPriceCents: 400000 } });
  });

  it("enforces the branch limit from the active subscription version", async () => {
    currentUser = { id: "owner-1", vendorId: "vendor-1", role: UserRole.VENDOR_ADMIN, name: "Owner", email: "owner@example.com" };
    vi.mocked(prisma.branch.count).mockResolvedValue(1);
    vi.mocked(prisma.vendorSubscription.findUnique).mockResolvedValue(subscriptionRecord(false) as any);

    const response = await request(testApp()).post("/api/branches").send({ name: "Second branch", address: "Kazanchis" });

    expect(response.status).toBe(409);
    expect(response.body.error).toContain("allows up to 1 branch");
    expect(prisma.branch.create).not.toHaveBeenCalled();
  });

  it("creates a complete starter workspace during vendor signup", async () => {
    vi.mocked(prisma.subscriptionPlan.findFirst).mockResolvedValue({ id: "standard", code: "STANDARD", versions: [{ id: "standard-v1", version: 1, currency: "ETB", monthlyPriceCents: 40000 }] } as any);
    vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => callback(prisma));
    vi.mocked(prisma.vendor.create).mockResolvedValue({ id: "vendor-1", slug: "selam-dental", status: VendorStatus.PENDING_REVIEW } as any);
    vi.mocked(prisma.branch.create).mockResolvedValue({ id: "branch-1" } as any);
    vi.mocked(prisma.service.create).mockResolvedValue({ id: "service-1" } as any);
    vi.mocked(prisma.staff.create).mockResolvedValue({ id: "staff-1" } as any);
    vi.mocked(prisma.user.create).mockResolvedValue({ id: "owner-1", email: "owner@selam.test" } as any);
    vi.mocked(prisma.workingHour.createMany).mockResolvedValue({ count: 6 } as any);
    vi.mocked(prisma.paymentInvoice.create).mockResolvedValue({ id: "invoice-1" } as any);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({ id: "audit-1" } as any);

    const response = await request(testApp()).post("/api/public/vendor-signup").send({
      ownerName: "Selam Tesfaye",
      ownerEmail: "owner@selam.test",
      ownerPhone: "+251911000100",
      password: "Password123!",
      businessName: "Selam Dental",
      businessType: "Dental clinic",
      slug: "selam-dental",
      branchName: "Bole Branch",
      branchAddress: "Bole, Addis Ababa",
      timezone: "Africa/Addis_Ababa",
      service: { name: "Consultation", category: "General", priceCents: 100000, durationMinutes: 30, bufferAfterMinutes: 10 },
      provider: { name: "Dr. Selam", roleTitle: "Dentist", phone: "+251911000100", email: "owner@selam.test" }
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ vendorId: "vendor-1", ownerEmail: "owner@selam.test", status: VendorStatus.PENDING_REVIEW, payment: { invoiceId: "invoice-1", token: expect.any(String) } });
    expect(prisma.paymentInvoice.create).toHaveBeenCalledWith({ data: expect.objectContaining({ vendorId: "vendor-1", amountCents: 40000, destinationPhone: process.env.TELEBIRR_PAYMENT_PHONE ?? "+251900000000" }) });
    expect(prisma.service.create).toHaveBeenCalledWith({ data: expect.objectContaining({ vendorId: "vendor-1", name: "Consultation" }) });
    expect(prisma.staff.create).toHaveBeenCalledWith({ data: expect.objectContaining({ branchId: "branch-1", services: { create: [{ serviceId: "service-1" }] } }) });
    expect(prisma.workingHour.createMany).toHaveBeenCalledWith({ data: expect.arrayContaining([{ vendorId: "vendor-1", weekday: 1, startTime: "09:00", endTime: "17:00" }]) });
  });

  it("resumes unpaid vendor signup with a fresh payment invoice instead of blocking the email", async () => {
    vi.mocked(prisma.subscriptionPlan.findFirst).mockResolvedValue({ id: "standard", code: "STANDARD", versions: [{ id: "standard-v2", version: 2, currency: "ETB", monthlyPriceCents: 40000 }] } as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "owner-1",
      email: "owner@selam.test",
      role: UserRole.VENDOR_ADMIN,
      vendor: {
        id: "vendor-1",
        status: VendorStatus.PENDING_REVIEW,
        subscription: { status: SubscriptionStatus.PENDING },
        paymentInvoices: []
      }
    } as any);
    vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => callback(prisma));
    vi.mocked(prisma.paymentInvoice.updateMany).mockResolvedValue({ count: 1 } as any);
    vi.mocked(prisma.vendorSubscription.update).mockResolvedValue({ id: "subscription-1" } as any);
    vi.mocked(prisma.paymentInvoice.create).mockResolvedValue({ id: "invoice-2" } as any);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({ id: "audit-1" } as any);

    const response = await request(testApp()).post("/api/public/vendor-signup").send({
      ownerName: "Selam Tesfaye",
      ownerEmail: "owner@selam.test",
      ownerPhone: "+251911000100",
      password: "Password123!",
      businessName: "Selam Dental",
      businessType: "Dental clinic",
      slug: "selam-dental",
      branchName: "Bole Branch",
      branchAddress: "Bole, Addis Ababa",
      timezone: "Africa/Addis_Ababa",
      service: { name: "Consultation", category: "General", priceCents: 100000, durationMinutes: 30, bufferAfterMinutes: 10 },
      provider: { name: "Dr. Selam", roleTitle: "Dentist", phone: "+251911000100", email: "owner@selam.test" }
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ vendorId: "vendor-1", ownerEmail: "owner@selam.test", resumed: true, payment: { invoiceId: "invoice-2", token: expect.any(String) } });
    expect(prisma.vendor.create).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.paymentInvoice.updateMany).toHaveBeenCalledWith({ where: { vendorId: "vendor-1", status: { in: [PaymentInvoiceStatus.PENDING, PaymentInvoiceStatus.SUBMITTED] } }, data: { status: PaymentInvoiceStatus.CANCELLED } });
    expect(prisma.vendorSubscription.update).toHaveBeenCalledWith({ where: { vendorId: "vendor-1" }, data: { planVersionId: "standard-v2", status: SubscriptionStatus.PENDING, provider: "telebirr_sms" } });
    expect(prisma.paymentInvoice.create).toHaveBeenCalledWith({ data: expect.objectContaining({ vendorId: "vendor-1", planVersionId: "standard-v2", amountCents: 40000 }) });
  });

  it("returns verified users to login after Telegram auto-activation", async () => {
    vi.mocked(completeTelegramLogin).mockResolvedValue({
      vendor: { id: "vendor-1", status: VendorStatus.ACTIVE },
      userEmail: "owner@selam.test",
      requiresLogin: true
    } as any);

    const response = await request(testApp()).get("/api/telegram/login/callback?code=code-1&state=state-1");

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain("/login");
    expect(response.headers.location).toContain("telegramVerification=success");
    expect(response.headers.location).toContain("owner%40selam.test");
  });

  it("only exposes active vendors and public booking fields", async () => {
    vi.mocked(prisma.vendor.findFirst).mockResolvedValue({
      id: "vendor-1",
      name: "Selam Dental",
      slug: "selam-dental",
      businessType: "Dental clinic",
      timezone: "Africa/Addis_Ababa",
      branches: [],
      services: [],
      staff: []
    } as any);

    const response = await request(testApp()).get("/api/public/vendors/selam-dental");

    expect(response.status).toBe(200);
    expect(prisma.vendor.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { slug: "selam-dental", status: { in: [VendorStatus.ACTIVE, VendorStatus.TRIAL] }, subscription: { status: SubscriptionStatus.ACTIVE } },
      select: expect.objectContaining({
        staff: expect.objectContaining({
          select: expect.objectContaining({ branchId: true, services: { select: { serviceId: true } } })
        })
      })
    }));
    const publicSelect = vi.mocked(prisma.vendor.findFirst).mock.calls.at(-1)?.[0]?.select as Record<string, unknown>;
    expect(publicSelect).not.toHaveProperty("telegramUserId");
    expect(publicSelect).not.toHaveProperty("phoneVerifiedAt");
  });

  it("resolves an active custom hostname without accepting a vendor id", async () => {
    vi.mocked(prisma.vendor.findFirst).mockResolvedValue({
      id: "vendor-1",
      name: "Selam Dental",
      slug: "selam-dental",
      businessType: "Dental clinic",
      timezone: "Africa/Addis_Ababa",
      branches: [],
      services: [],
      staff: []
    } as any);

    const response = await request(testApp()).get("/api/public/domains/book.selam.example");

    expect(response.status).toBe(200);
    expect(prisma.vendor.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        status: { in: [VendorStatus.ACTIVE, VendorStatus.TRIAL] },
        subscription: {
          status: SubscriptionStatus.ACTIVE,
          planVersion: { entitlements: { some: { key: "customDomain", value: { equals: true } } } }
        },
        customDomains: { some: { hostname: "book.selam.example", status: DomainStatus.ACTIVE } }
      }
    }));
  });

  it("authorizes certificate issuance only for an active paid custom domain", async () => {
    vi.mocked(prisma.vendorDomain.findFirst).mockResolvedValue({ id: "domain-1" } as any);

    const response = await request(testApp()).get("/api/public/domains/authorize?domain=Book.Selam.Example");

    expect(response.status).toBe(204);
    expect(prisma.vendorDomain.findFirst).toHaveBeenCalledWith({
      where: {
        hostname: "book.selam.example",
        status: DomainStatus.ACTIVE,
        vendor: {
          status: { in: [VendorStatus.ACTIVE, VendorStatus.TRIAL] },
          subscription: {
            status: SubscriptionStatus.ACTIVE,
            planVersion: { entitlements: { some: { key: "customDomain", value: { equals: true } } } }
          }
        }
      },
      select: { id: true }
    });
  });

  it("rejects certificate issuance for an unknown or ineligible domain", async () => {
    vi.mocked(prisma.vendorDomain.findFirst).mockResolvedValue(null);

    const response = await request(testApp()).get("/api/public/domains/authorize?domain=unknown.example");

    expect(response.status).toBe(404);
  });

  it("blocks vendors whose paid plan excludes custom domains", async () => {
    currentUser = {
      id: "owner-1",
      vendorId: "vendor-1",
      role: UserRole.VENDOR_ADMIN,
      name: "Vendor Owner",
      email: "owner@example.com"
    };
    vi.mocked(prisma.vendor.findUnique).mockResolvedValue({ id: "vendor-1", customDomains: [] } as any);
    vi.mocked(prisma.vendorSubscription.findUnique).mockResolvedValue(subscriptionRecord(false) as any);

    const response = await request(testApp()).post("/api/domains").send({ hostname: "book.selam.example" });

    expect(response.status).toBe(403);
    expect(response.body.error).toContain("does not include custom domains");
    expect(prisma.vendorDomain.create).not.toHaveBeenCalled();
  });

  it("lets a vendor restore an archived service", async () => {
    currentUser = {
      id: "owner-1",
      vendorId: "vendor-1",
      role: UserRole.VENDOR_ADMIN,
      name: "Vendor Owner",
      email: "owner@example.com"
    };
    vi.mocked(prisma.service.findFirst).mockResolvedValue({ id: "service-1", vendorId: "vendor-1", active: false } as any);
    vi.mocked(prisma.service.update).mockResolvedValue({ id: "service-1", active: true } as any);

    const response = await request(testApp()).patch("/api/services/service-1").send({ active: true });

    expect(response.status).toBe(200);
    expect(prisma.service.update).toHaveBeenCalledWith({ where: { id: "service-1" }, data: { active: true } });
  });

  it("preserves an archived service that has appointment history", async () => {
    currentUser = {
      id: "owner-1",
      vendorId: "vendor-1",
      role: UserRole.VENDOR_ADMIN,
      name: "Vendor Owner",
      email: "owner@example.com"
    };
    vi.mocked(prisma.service.findFirst).mockResolvedValue({ id: "service-1", vendorId: "vendor-1", active: false } as any);
    vi.mocked(prisma.appointment.count).mockResolvedValue(3);

    const response = await request(testApp()).delete("/api/services/service-1/permanent");

    expect(response.status).toBe(409);
    expect(response.body.error).toContain("appointment history");
    expect(prisma.service.delete).not.toHaveBeenCalled();
  });

  it("allows a custom-domain vendor to provision one normalized hostname", async () => {
    currentUser = {
      id: "owner-1",
      vendorId: "vendor-1",
      role: UserRole.VENDOR_ADMIN,
      name: "Vendor Owner",
      email: "owner@example.com"
    };
    vi.mocked(prisma.vendor.findUnique).mockResolvedValue({ id: "vendor-1", customDomains: [] } as any);
    vi.mocked(prisma.vendorSubscription.findUnique).mockResolvedValue(subscriptionRecord(true) as any);
    vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => callback(prisma));
    vi.mocked(prisma.vendorDomain.create).mockResolvedValue({ id: "domain-1", vendorId: "vendor-1", hostname: "book.selam.example", status: DomainStatus.PENDING } as any);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({ id: "audit-1" } as any);

    const response = await request(testApp()).post("/api/domains").send({ hostname: "HTTPS://Book.Selam.Example/" });

    expect(response.status).toBe(201);
    expect(prisma.vendorDomain.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ vendorId: "vendor-1", hostname: "book.selam.example", cnameTarget: "domains.appointit.com" })
    });
  });

  it("lets super admins assign the latest published paid plan", async () => {
    vi.mocked(prisma.vendor.findUnique).mockResolvedValue({ id: "vendor-1", subscription: null } as any);
    vi.mocked(prisma.subscriptionPlan.findFirst).mockResolvedValue({ id: "premium", code: "PREMIUM", name: "Premium", versions: [{ id: "premium-v1", version: 1, entitlements: entitlementRows(true) }] } as any);
    vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => callback(prisma));
    vi.mocked(prisma.vendorSubscription.upsert).mockResolvedValue(subscriptionRecord(true) as any);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({ id: "audit-1" } as any);

    const response = await request(testApp()).patch("/api/vendors/vendor-1/plan").send({ planId: "premium" });

    expect(response.status).toBe(200);
    expect(response.body.subscription.planVersion.plan.code).toBe("PREMIUM");
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "vendor_plan_changed" }) });
  });

  it("dispatches a first public booking through the booking engine", async () => {
    vi.mocked(prisma.vendor.findFirst).mockResolvedValue({ id: "vendor-1", status: VendorStatus.ACTIVE } as any);
    vi.mocked(createAppointment).mockResolvedValue({ id: "appointment-1", status: "PENDING", endAt: new Date(Date.now() + 90_000_000), managementTokenVersion: 0 } as any);

    const startAt = new Date(Date.now() + 86_400_000).toISOString();
    const response = await request(testApp()).post("/api/public/vendors/selam-dental/book").send({
      branchId: "branch-1",
      serviceId: "service-1",
      staffId: "staff-1",
      startAt,
      customer: { name: "Mekdes Alemu", phone: "+251911000200", email: "mekdes@example.com" }
    });

    expect(response.status).toBe(201);
    expect(createAppointment).toHaveBeenCalledWith(expect.objectContaining({
      vendorId: "vendor-1",
      source: AppointmentSource.PUBLIC_BOOKING,
      branchId: "branch-1",
      serviceId: "service-1"
    }));
  });

  it("returns pending-review details when login is blocked", async () => {
    vi.mocked(login).mockResolvedValue({
      ok: false,
      reason: "PENDING_REVIEW",
      vendorStatus: VendorStatus.PENDING_REVIEW
    });

    const response = await request(testApp())
      .post("/api/auth/login")
      .send({ email: "owner@example.com", password: "Password123!" });

    expect(response.status).toBe(403);
    expect(response.body.reason).toBe("PENDING_REVIEW");
  });

  it("starts an SMS challenge when login needs phone verification", async () => {
    vi.mocked(login).mockResolvedValue({
      ok: false,
      reason: "PHONE_VERIFICATION_REQUIRED",
      vendorStatus: VendorStatus.PENDING_REVIEW,
      userId: "owner-1"
    });
    vi.mocked(startPhoneVerification).mockResolvedValue({
      challengeToken: "challenge-token-that-is-long-enough-123456",
      phone: "+251******100",
      expiresAt: new Date(Date.now() + 300000),
      resendAvailableAt: new Date(Date.now() + 60000)
    });

    const response = await request(testApp())
      .post("/api/auth/login")
      .send({ email: "owner@example.com", password: "Password123!" });

    expect(response.status).toBe(403);
    expect(response.body.reason).toBe("PHONE_VERIFICATION_REQUIRED");
    expect(response.body.challengeToken).toBeTruthy();
    expect(response.body.phone).toBe("+251******100");
  });

  it("starts a login 2FA challenge when SMS two-factor authentication is enabled", async () => {
    vi.mocked(login).mockResolvedValue({
      ok: false,
      reason: "TWO_FACTOR_REQUIRED",
      vendorStatus: VendorStatus.ACTIVE,
      userId: "owner-1"
    });
    vi.mocked(startPhoneVerification).mockResolvedValue({
      challengeToken: "challenge-token-that-is-long-enough-123456",
      phone: "+251******100",
      expiresAt: new Date(Date.now() + 300000),
      resendAvailableAt: new Date(Date.now() + 60000)
    });

    const response = await request(testApp())
      .post("/api/auth/login")
      .send({ email: "owner@example.com", password: "Password123!" });

    expect(response.status).toBe(403);
    expect(response.body.reason).toBe("TWO_FACTOR_REQUIRED");
    expect(startPhoneVerification).toHaveBeenCalledWith("owner-1", PhoneChallengePurpose.LOGIN_2FA);
  });

  it("enables SMS 2FA with the current password and revokes refresh sessions", async () => {
    currentUser = {
      id: "owner-1",
      vendorId: "vendor-1",
      role: UserRole.VENDOR_ADMIN,
      name: "Vendor Admin",
      email: "owner@example.com"
    };
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "owner-1",
      vendorId: "vendor-1",
      active: true,
      phone: "+251911000100",
      phoneVerifiedAt: new Date(),
      smsTwoFactorEnabled: false,
      passwordHash: bcrypt.hashSync("Password123!", 4)
    } as any);
    vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => callback(prisma));
    vi.mocked(prisma.user.update).mockResolvedValue({ id: "owner-1", smsTwoFactorEnabled: true } as any);
    vi.mocked(prisma.authRefreshToken.updateMany).mockResolvedValue({ count: 1 } as any);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({ id: "audit-1" } as any);

    const response = await request(testApp())
      .put("/api/auth/security/two-factor")
      .send({ enabled: true, currentPassword: "Password123!" });

    expect(response.status).toBe(200);
    expect(response.body.smsTwoFactorEnabled).toBe(true);
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: "owner-1" }, data: { smsTwoFactorEnabled: true } });
    expect(prisma.authRefreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "owner-1", revokedAt: null },
      data: { revokedAt: expect.any(Date) }
    });
  });

  it("activates vendor admins when super admin approves a vendor", async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => callback(prisma));
    vi.mocked(prisma.vendor.findUnique).mockResolvedValue({ id: "vendor-1", phoneVerifiedAt: new Date() } as any);
    vi.mocked(prisma.vendor.update).mockResolvedValue({ id: "vendor-1", status: VendorStatus.ACTIVE } as any);
    vi.mocked(prisma.user.updateMany).mockResolvedValue({ count: 1 } as any);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({ id: "audit-1" } as any);

    const response = await request(testApp())
      .patch("/api/vendors/vendor-1/status")
      .send({ status: "ACTIVE" });

    expect(response.status).toBe(200);
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { vendorId: "vendor-1", role: UserRole.VENDOR_ADMIN },
      data: { active: true }
    });
    expect(prisma.auditLog.create).toHaveBeenCalled();
  });

  it("blocks super admin approval until vendor phone is verified", async () => {
    vi.mocked(prisma.vendor.findUnique).mockResolvedValue({ id: "vendor-1", phoneVerifiedAt: null } as any);

    const response = await request(testApp())
      .patch("/api/vendors/vendor-1/status")
      .send({ status: "ACTIVE" });

    expect(response.status).toBe(409);
    expect(response.body.error).toContain("phone must be verified");
    expect(prisma.vendor.update).not.toHaveBeenCalled();
  });

  it("returns conflict when appointment creation fails availability validation", async () => {
    currentUser = {
      id: "vendor-user",
      vendorId: "vendor-1",
      role: UserRole.VENDOR_ADMIN,
      name: "Vendor Admin",
      email: "admin@vendor.test"
    };
    vi.mocked(createAppointment).mockRejectedValue(new Error("Selected time is already booked"));

    const response = await request(testApp())
      .post("/api/appointments")
      .send({
        branchId: "branch-1",
        serviceId: "service-1",
        startAt: new Date().toISOString(),
        customer: {
          name: "Mekdes Alemu",
          phone: "+251911000001"
        }
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe("Selected time is already booked");
  });

  it("supports appointment complete and no-show lifecycle actions", async () => {
    currentUser = {
      id: "vendor-user",
      vendorId: "vendor-1",
      role: UserRole.VENDOR_ADMIN,
      name: "Vendor Admin",
      email: "admin@vendor.test"
    };
    vi.mocked(completeAppointment).mockResolvedValue({ id: "appt-1", status: "COMPLETED" } as any);
    vi.mocked(markNoShowAppointment).mockResolvedValue({ id: "appt-1", status: "NO_SHOW" } as any);

    const completed = await request(testApp()).post("/api/appointments/appt-1/complete").send({});
    const noShow = await request(testApp()).post("/api/appointments/appt-1/no-show").send({});

    expect(completed.status).toBe(200);
    expect(completed.body.status).toBe("COMPLETED");
    expect(noShow.status).toBe(200);
    expect(noShow.body.status).toBe("NO_SHOW");
  });

  it("queues a manual SMS reminder when the customer has consented", async () => {
    currentUser = { id: "vendor-user", vendorId: "vendor-1", role: UserRole.VENDOR_ADMIN, name: "Vendor Admin", email: "admin@vendor.test" };
    vi.mocked(prisma.appointment.findFirst).mockResolvedValue({
      id: "appt-1", vendorId: "vendor-1", startAt: new Date(Date.now() + 86_400_000), status: "CONFIRMED",
      customer: { email: "customer@example.com", phone: "+251911000001", smsOptIn: true },
      vendor: { messageSettings: { smsEnabled: true, encryptedSmsGatewayApiKey: "encrypted", smsFrom: "Vendor" } }
    } as any);
    vi.mocked(prisma.appointmentHistory.create).mockResolvedValue({ id: "history-1" } as any);

    const response = await request(testApp()).post("/api/appointments/appt-1/remind").send({});

    expect(response.status).toBe(202);
    expect(response.body.channels).toEqual(["sms"]);
    expect(enqueueAppointmentNotification).toHaveBeenCalledWith("appt-1", "manual_reminder", expect.objectContaining({ jobId: expect.stringContaining("appointment:appt-1:manual-"), channels: ["sms"] }));
  });

  it("queues a manual SMS reminder when sender name is not configured", async () => {
    currentUser = { id: "vendor-user", vendorId: "vendor-1", role: UserRole.VENDOR_ADMIN, name: "Vendor Admin", email: "admin@vendor.test" };
    vi.mocked(prisma.appointment.findFirst).mockResolvedValue({
      id: "appt-1", vendorId: "vendor-1", startAt: new Date(Date.now() + 86_400_000), status: "CONFIRMED",
      customer: { email: "customer@example.com", phone: "+251911000001", smsOptIn: true },
      vendor: { messageSettings: { smsEnabled: true, encryptedSmsGatewayApiKey: "encrypted", smsFrom: null } }
    } as any);
    vi.mocked(prisma.appointmentHistory.create).mockResolvedValue({ id: "history-1" } as any);

    const response = await request(testApp()).post("/api/appointments/appt-1/remind").send({});

    expect(response.status).toBe(202);
    expect(enqueueAppointmentNotification).toHaveBeenCalledWith("appt-1", "manual_reminder", expect.objectContaining({ channels: ["sms"] }));
  });


  it("explains why a manual reminder cannot be delivered", async () => {
    currentUser = { id: "vendor-user", vendorId: "vendor-1", role: UserRole.VENDOR_ADMIN, name: "Vendor Admin", email: "admin@vendor.test" };
    vi.mocked(prisma.appointment.findFirst).mockResolvedValue({
      id: "appt-1", vendorId: "vendor-1", startAt: new Date(Date.now() + 86_400_000), status: "CONFIRMED",
      customer: { email: null, phone: "+251911000001", smsOptIn: false },
      vendor: { messageSettings: { smsEnabled: true, encryptedSmsGatewayApiKey: "encrypted", smsFrom: "Vendor" } }
    } as any);

    const response = await request(testApp()).post("/api/appointments/appt-1/remind").send({});

    expect(response.status).toBe(409);
    expect(response.body.error).toContain("has not consented to SMS");
    expect(enqueueAppointmentNotification).not.toHaveBeenCalled();
  });

  it("scopes staff appointment list to the logged-in staff profile", async () => {
    currentUser = {
      id: "staff-user",
      vendorId: "vendor-1",
      staffId: "staff-1",
      role: UserRole.STAFF,
      name: "Dr. Hana",
      email: "hana@vendor.test"
    };
    vi.mocked(prisma.appointment.findMany).mockResolvedValue([] as any);

    const response = await request(testApp()).get("/api/appointments");

    expect(response.status).toBe(200);
    expect(prisma.appointment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { vendorId: "vendor-1", staffId: "staff-1" }
    }));
  });

  it("blocks staff from creating appointments manually", async () => {
    currentUser = {
      id: "staff-user",
      vendorId: "vendor-1",
      staffId: "staff-1",
      role: UserRole.STAFF,
      name: "Dr. Hana",
      email: "hana@vendor.test"
    };

    const response = await request(testApp())
      .post("/api/appointments")
      .send({
        branchId: "branch-1",
        serviceId: "service-1",
        startAt: new Date().toISOString(),
        customer: { name: "Mekdes Alemu", phone: "+251911000001" }
      });

    expect(response.status).toBe(403);
    expect(createAppointment).not.toHaveBeenCalled();
  });

  it("creates staff invite links for vendor admins", async () => {
    currentUser = {
      id: "vendor-user",
      vendorId: "vendor-1",
      role: UserRole.VENDOR_ADMIN,
      name: "Vendor Admin",
      email: "admin@vendor.test"
    };
    vi.mocked(prisma.staff.findFirst).mockResolvedValue({ id: "staff-1", vendorId: "vendor-1" } as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.staffInvite.create).mockResolvedValue({
      id: "invite-1",
      vendorId: "vendor-1",
      staffId: "staff-1",
      email: "hana@vendor.test",
      name: "Dr. Hana",
      role: UserRole.STAFF,
      expiresAt: new Date(Date.now() + 1000)
    } as any);

    const response = await request(testApp())
      .post("/api/staff/invites")
      .send({ staffId: "staff-1", name: "Dr. Hana", email: "hana@vendor.test", role: "STAFF" });

    expect(response.status).toBe(201);
    expect(response.body.inviteUrl).toContain("/accept-invite?token=");
    expect(response.body.token).toBeTruthy();
  });

  it("refreshes an access token and rotates the refresh token", async () => {
    vi.mocked(prisma.authRefreshToken.findUnique).mockResolvedValue({
      id: "refresh-1",
      userId: "user-1",
      revokedAt: null,
      expiresAt: new Date(Date.now() + 100000),
      user: {
        id: "user-1",
        vendorId: "vendor-1",
        staffId: null,
        active: true,
        phoneVerifiedAt: new Date(),
        role: UserRole.VENDOR_ADMIN,
        name: "Vendor Admin",
        email: "admin@vendor.test",
        vendor: { status: VendorStatus.ACTIVE, subscription: { status: SubscriptionStatus.ACTIVE } }
      }
    } as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user-1",
      vendorId: "vendor-1",
      staffId: null,
      active: true,
      phoneVerifiedAt: new Date(),
      role: UserRole.VENDOR_ADMIN,
      name: "Vendor Admin",
      email: "admin@vendor.test",
      vendor: { status: VendorStatus.ACTIVE, subscription: { status: SubscriptionStatus.ACTIVE } }
    } as any);
    vi.mocked(prisma.authRefreshToken.update).mockResolvedValue({ id: "refresh-1" } as any);
    vi.mocked(prisma.authRefreshToken.create).mockResolvedValue({ id: "refresh-2" } as any);

    const response = await request(testApp())
      .post("/api/auth/refresh")
      .send({ refreshToken: "valid-refresh-token-123456" });

    expect(response.status).toBe(200);
    expect(response.body.accessToken).toBeTruthy();
    expect(response.body.refreshToken).toBeTruthy();
    expect(prisma.authRefreshToken.update).toHaveBeenCalledWith({ where: { id: "refresh-1" }, data: { revokedAt: expect.any(Date) } });
  });

  it("emails a password reset link without exposing the token", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user-1",
      vendorId: "vendor-1",
      active: true,
      email: "admin@vendor.test"
    } as any);
    vi.mocked(prisma.passwordResetToken.create).mockResolvedValue({ id: "reset-1" } as any);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({ id: "audit-1" } as any);

    const response = await request(testApp())
      .post("/api/auth/password-reset/request")
      .send({ email: "admin@vendor.test" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      message: "If that account exists, password reset instructions have been sent by email."
    });
    expect(response.body.resetUrl).toBeUndefined();
    expect(prisma.passwordResetToken.updateMany).toHaveBeenCalled();
    expect(prisma.passwordResetToken.create).toHaveBeenCalled();
    expect(sendPlatformEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: "admin@vendor.test",
      subject: "Reset your AppointIt password",
      text: expect.stringContaining("/reset-password?token="),
      html: expect.stringContaining(">Reset password</a>")
    }));
  });

  it("changes password and revokes active refresh tokens", async () => {
    currentUser = {
      id: "user-1",
      vendorId: "vendor-1",
      role: UserRole.VENDOR_ADMIN,
      name: "Vendor Admin",
      email: "admin@vendor.test"
    };
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "user-1", vendorId: "vendor-1", passwordHash: bcrypt.hashSync("Password123!", 4) } as any);
    vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => callback(prisma));
    vi.mocked(prisma.user.update).mockResolvedValue({ id: "user-1" } as any);
    vi.mocked(prisma.authRefreshToken.updateMany).mockResolvedValue({ count: 1 } as any);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({ id: "audit-1" } as any);

    const response = await request(testApp())
      .post("/api/auth/change-password")
      .send({ currentPassword: "Password123!", newPassword: "NewPassword123!" });

    expect(response.status).toBe(200);
    expect(prisma.authRefreshToken.updateMany).toHaveBeenCalledWith({ where: { userId: "user-1", revokedAt: null }, data: { revokedAt: expect.any(Date) } });
  });
});
