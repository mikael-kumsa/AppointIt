import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentInvoiceStatus, PaymentSmsStatus } from "@prisma/client";

vi.mock("../src/db.js", () => ({
  prisma: {
    $transaction: vi.fn(),
    paymentInvoice: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    telebirrSmsEvent: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    vendorSubscription: { update: vi.fn(), upsert: vi.fn() },
    planVersion: { findUniqueOrThrow: vi.fn() },
    vendorDomain: { updateMany: vi.fn() },
    calendarConnection: { updateMany: vi.fn() },
    messageSetting: { updateMany: vi.fn() },
    auditLog: { create: vi.fn() }
  }
}));

import { prisma } from "../src/db.js";
import { claimPayment, ingestTelebirrSms, paymentTokenHash, reviewPayment, uploadPaymentProof } from "../src/modules/payments/payments.service.js";

const message = "You have received ETB 400.00 from EMBET TAMIRU(2519****6985) on 29/06/2026 08:37:55. Your transaction number is DFT3DDIXIX.";
const db = prisma as any;
let invoice: any;
let sms: any;

beforeEach(() => {
  vi.clearAllMocks();
  sms = null;
  invoice = {
    id: "invoice-1",
    vendorId: "vendor-1",
    planVersionId: "plan-v1",
    accessTokenHash: paymentTokenHash("a".repeat(32)),
    amountCents: 40000,
    currency: "ETB",
    status: PaymentInvoiceStatus.PENDING,
    claimedTransactionId: null,
    submittedAt: null,
    proofUploadedAt: null,
    expiresAt: new Date(Date.now() + 60_000)
  };
  db.$transaction.mockImplementation(async (callback: any) => callback(db));
  db.paymentInvoice.findFirst.mockImplementation(async ({ where }: any) => {
    if (where.id && (where.id !== invoice.id || where.accessTokenHash !== invoice.accessTokenHash)) return null;
    return invoice;
  });
  db.paymentInvoice.findUnique.mockImplementation(async ({ where }: any) => {
    if (where.id) return where.id === invoice.id ? invoice : null;
    if (where.claimedTransactionId) return invoice.claimedTransactionId === where.claimedTransactionId ? invoice : null;
    return null;
  });
  db.paymentInvoice.update.mockImplementation(async ({ data }: any) => Object.assign(invoice, data));
  db.telebirrSmsEvent.findFirst.mockImplementation(async () => sms);
  db.telebirrSmsEvent.findUnique.mockImplementation(async ({ where }: any) => sms?.transactionId === where.transactionId || sms?.id === where.id ? sms : null);
  db.telebirrSmsEvent.create.mockImplementation(async ({ data }: any) => (sms = { id: "sms-1", status: PaymentSmsStatus.RECEIVED, ...data }));
  db.telebirrSmsEvent.update.mockImplementation(async ({ data }: any) => Object.assign(sms, data));
  db.vendorSubscription.update.mockResolvedValue({ id: "subscription-1" });
  db.vendorSubscription.upsert.mockResolvedValue({ id: "subscription-1" });
  db.planVersion.findUniqueOrThrow.mockResolvedValue({ entitlements: [
    { key: "maxBranches", value: 5 }, { key: "maxStaff", value: 20 }, { key: "customDomain", value: true },
    { key: "calendarSync", value: true }, { key: "smsAutomation", value: true }, { key: "advancedReports", value: true },
    { key: "auditRetentionDays", value: 365 }, { key: "prioritySupport", value: false }, { key: "customIntegrations", value: false }
  ] });
  db.auditLog.create.mockResolvedValue({ id: "audit-1" });
});

describe("Telebirr payment reconciliation", () => {
  it("matches when the vendor submits before the SMS arrives", async () => {
    await expect(claimPayment(invoice.id, "a".repeat(32), "dft3ddixix")).resolves.toBe("SUBMITTED");
    await expect(ingestTelebirrSms({ sender: "127", message, deviceId: "phone-1" })).resolves.toMatchObject({ status: "PAID" });

    expect(invoice.status).toBe(PaymentInvoiceStatus.PAID);
    expect(db.vendorSubscription.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { vendorId: "vendor-1" },
      data: expect.objectContaining({ status: "ACTIVE", providerSubscriptionId: "DFT3DDIXIX" })
    }));
  });

  it("matches when the SMS arrives before the transaction is submitted", async () => {
    await expect(ingestTelebirrSms({ sender: "127", message })).resolves.toMatchObject({ status: "RECEIVED" });
    await expect(claimPayment(invoice.id, "a".repeat(32), "DFT3DDIXIX")).resolves.toBe("PAID");
    expect(sms.status).toBe(PaymentSmsStatus.MATCHED);
  });

  it("routes an exact transaction with the wrong amount to review", async () => {
    invoice.amountCents = 50000;
    invoice.claimedTransactionId = "DFT3DDIXIX";
    await expect(ingestTelebirrSms({ sender: "127", message })).resolves.toMatchObject({ status: "REVIEW" });
    expect(invoice.status).toBe(PaymentInvoiceStatus.REVIEW);
    expect(db.vendorSubscription.update).not.toHaveBeenCalled();
  });

  it("rejects forwarded messages from any sender other than 127", async () => {
    await expect(ingestTelebirrSms({ sender: "Telebirr", message })).rejects.toThrow("sender 127");
  });

  it("allows a corrected transaction number after the 20-second match window", async () => {
    invoice.status = PaymentInvoiceStatus.SUBMITTED;
    invoice.claimedTransactionId = "WRONG123";
    invoice.submittedAt = new Date(Date.now() - 21_000);
    await expect(claimPayment(invoice.id, "a".repeat(32), "DFT3DDIXIX")).resolves.toBe("SUBMITTED");
    expect(invoice.claimedTransactionId).toBe("DFT3DDIXIX");
  });

  it("stores uploaded proof and routes the invoice to review", async () => {
    await expect(uploadPaymentProof(invoice.id, "a".repeat(32), {
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00]), mimetype: "image/jpeg", originalname: "receipt.jpg"
    })).resolves.toBe("REVIEW");
    expect(invoice.status).toBe(PaymentInvoiceStatus.REVIEW);
    expect(invoice.proofData).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0x00]));
    expect(db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "telebirr_payment_proof_uploaded" }) });
  });

  it("activates a subscription when an admin approves uploaded proof", async () => {
    invoice.status = PaymentInvoiceStatus.REVIEW;
    await expect(reviewPayment(invoice.id, "admin-1", "approve", "Receipt verified")).resolves.toMatchObject({ status: "PAID", vendorId: "vendor-1" });
    expect(db.vendorSubscription.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { vendorId: "vendor-1" }, update: expect.objectContaining({ status: "ACTIVE", provider: "telebirr_proof" }) }));
    expect(invoice.reviewedById).toBe("admin-1");
  });
});
