import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SubscriptionStatus, UserRole, VendorStatus } from "@prisma/client";

vi.mock("../src/db.js", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    authRefreshToken: { create: vi.fn() },
    auditLog: { create: vi.fn() }
  }
}));

import { prisma } from "../src/db.js";
import { login } from "../src/modules/auth/auth.service.js";

beforeEach(() => vi.clearAllMocks());

describe("SMS two-factor login", () => {
  it("does not issue tokens until a configured user completes the SMS challenge", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "owner-1",
      vendorId: "vendor-1",
      staffId: null,
      active: true,
      name: "Vendor Owner",
      email: "owner@example.com",
      phone: "+251911000100",
      phoneVerifiedAt: new Date(),
      smsTwoFactorEnabled: true,
      passwordHash: bcrypt.hashSync("Password123!", 4),
      role: UserRole.VENDOR_ADMIN,
      vendor: { status: VendorStatus.ACTIVE, subscription: { status: SubscriptionStatus.ACTIVE } }
    } as any);

    const result = await login("owner@example.com", "Password123!");

    expect(result).toMatchObject({
      ok: false,
      reason: "TWO_FACTOR_REQUIRED",
      userId: "owner-1"
    });
    expect(prisma.authRefreshToken.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("blocks workspace login while a paid subscription is pending", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "owner-1", vendorId: "vendor-1", staffId: null, active: true, name: "Vendor Owner",
      email: "owner@example.com", phone: "+251911000100", phoneVerifiedAt: new Date(),
      smsTwoFactorEnabled: false, passwordHash: bcrypt.hashSync("Password123!", 4), role: UserRole.VENDOR_ADMIN,
      vendor: { status: VendorStatus.ACTIVE, subscription: { status: SubscriptionStatus.PENDING } }
    } as any);

    const result = await login("owner@example.com", "Password123!");

    expect(result).toMatchObject({ ok: false, reason: "SUBSCRIPTION_REQUIRED" });
    expect(prisma.authRefreshToken.create).not.toHaveBeenCalled();
  });
});
