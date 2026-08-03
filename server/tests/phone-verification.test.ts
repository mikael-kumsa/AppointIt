import { beforeEach, describe, expect, it, vi } from "vitest";
import { PhoneChallengePurpose, UserRole, VendorStatus } from "@prisma/client";

vi.mock("../src/db.js", () => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn() },
    vendor: { update: vi.fn() },
    phoneVerificationSession: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn()
    },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn()
  }
}));

import { prisma } from "../src/db.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("DATABASE_URL", "postgresql://appointit:appointit@localhost:5433/appointit?schema=public");
  vi.stubEnv("AFROMESSAGE_API_URL", "https://api.afromessage.test/api");
  vi.stubEnv("AFROMESSAGE_API_TOKEN", "platform-api-token");
  vi.stubEnv("AFROMESSAGE_IDENTIFIER_ID", "platform-identifier");
  vi.stubEnv("AFROMESSAGE_SENDER_NAME", "AppointIt");
  vi.stubGlobal("fetch", vi.fn());
  vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => callback(prisma));
});

describe("AfroMessage phone verification", () => {
  it("creates a password-authenticated OTP challenge without storing the provider code", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "owner-1",
      vendorId: "vendor-1",
      active: true,
      phone: "0911000100",
      vendor: { id: "vendor-1", phone: "0911000100" }
    } as any);
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        acknowledge: "success",
        response: { verificationId: "verification-1", code: "123456", to: "+251911000100" }
      })
    } as Response);

    const { startPhoneVerification } = await import("../src/modules/auth/phone-verification.service.js");
    const result = await startPhoneVerification("owner-1");

    expect(result.challengeToken).toHaveLength(43);
    expect(result.phone).toContain("***");
    expect(prisma.phoneVerificationSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "owner-1",
        vendorId: "vendor-1",
        providerVerificationId: "verification-1",
        phone: "+251911000100"
      })
    });
    expect(prisma.phoneVerificationSession.create).not.toHaveBeenCalledWith({
      data: expect.objectContaining({ code: "123456" })
    });
  });

  it("verifies the code and automatically activates a pending vendor", async () => {
    vi.mocked(prisma.phoneVerificationSession.findUnique).mockResolvedValue({
      id: "session-1",
      userId: "owner-1",
      vendorId: "vendor-1",
      tokenHash: "hash",
      providerVerificationId: "verification-1",
      phone: "+251911000100",
      attempts: 0,
      expiresAt: new Date(Date.now() + 300000),
      verifiedAt: null,
      user: { id: "owner-1", role: UserRole.VENDOR_ADMIN },
      vendor: { id: "vendor-1", status: VendorStatus.PENDING_REVIEW }
    } as any);
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ acknowledge: "success", response: { verificationId: "verification-1", phone: "+251911000100" } })
    } as Response);

    const { completePhoneVerification } = await import("../src/modules/auth/phone-verification.service.js");
    await completePhoneVerification("challenge-token-that-is-long-enough", "123456");

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "owner-1" },
      data: { phoneVerifiedAt: expect.any(Date), phone: "+251911000100" }
    });
    expect(prisma.vendor.update).toHaveBeenCalledWith({
      where: { id: "vendor-1" },
      data: { phone: "+251911000100", phoneVerifiedAt: expect.any(Date), status: VendorStatus.ACTIVE }
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "phone_verified_with_afromessage" }) });
  });

  it("does not expose provider or beta-contact errors to the user", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "owner-1",
      vendorId: "vendor-1",
      active: true,
      phone: "+251987555000",
      vendor: { id: "vendor-1", phone: "+251987555000" }
    } as any);
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        acknowledge: "error",
        response: { errors: ["+251987555000 is unverified contact number"] }
      })
    } as Response);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { startPhoneVerification } = await import("../src/modules/auth/phone-verification.service.js");
    await expect(startPhoneVerification("owner-1")).rejects.toMatchObject({
      code: "OTP_DELIVERY_FAILED",
      message: "We could not send a verification code. Please try again later or contact support."
    });
    expect(log).toHaveBeenCalledWith("AfroMessage verification delivery failed", {
      userId: "owner-1",
      detail: "[phone] is unverified contact number"
    });
    log.mockRestore();
  });

  it("completes a login 2FA challenge without changing phone or vendor verification", async () => {
    vi.mocked(prisma.phoneVerificationSession.findUnique).mockResolvedValue({
      id: "session-2fa",
      userId: "owner-1",
      vendorId: "vendor-1",
      providerVerificationId: "verification-2fa",
      phone: "+251911000100",
      purpose: PhoneChallengePurpose.LOGIN_2FA,
      attempts: 0,
      expiresAt: new Date(Date.now() + 300000),
      verifiedAt: null,
      user: {
        id: "owner-1",
        role: UserRole.VENDOR_ADMIN,
        phoneVerifiedAt: new Date(),
        smsTwoFactorEnabled: true
      },
      vendor: { id: "vendor-1", status: VendorStatus.ACTIVE }
    } as any);
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ acknowledge: "success", response: { verificationId: "verification-2fa" } })
    } as Response);

    const { completePhoneVerification } = await import("../src/modules/auth/phone-verification.service.js");
    const result = await completePhoneVerification("challenge-token-that-is-long-enough", "123456");

    expect(result.purpose).toBe(PhoneChallengePurpose.LOGIN_2FA);
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.vendor.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "sms_two_factor_login_completed" })
    });
  });
});
