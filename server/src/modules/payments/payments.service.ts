import crypto from "node:crypto";
import { PaymentInvoiceStatus, PaymentSmsStatus, Prisma, SubscriptionStatus } from "@prisma/client";
import { prisma } from "../../db.js";
import { env } from "../../config/env.js";
import { encryptSecret } from "../../utils/crypto.js";
import { normalizeTransactionId, parseTelebirrCredit } from "./telebirr-parser.js";
import { publishLiveEvent } from "../live/live-events.js";
import { applyPlanCapabilityState } from "../plans/plans.service.js";

export function paymentTokenHash(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function newPaymentToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function paymentInvoiceExpiry() {
  return new Date(Date.now() + env.PAYMENT_INVOICE_TTL_HOURS * 60 * 60 * 1000);
}

export async function createVendorPaymentInvoice(vendorId: string, planId: string) {
  const plan = await prisma.subscriptionPlan.findFirst({
    where: { id: planId, active: true, isPublic: true },
    include: { versions: { where: { status: "PUBLISHED" }, orderBy: { version: "desc" }, take: 1 } }
  });
  const version = plan?.versions[0];
  if (!plan || !version || version.currency !== "ETB" || version.monthlyPriceCents === null) throw new Error("This plan is not available for automatic Telebirr payment");
  const token = newPaymentToken();
  const invoice = await prisma.$transaction(async (tx) => {
    await tx.paymentInvoice.updateMany({
      where: { vendorId, status: { in: [PaymentInvoiceStatus.PENDING, PaymentInvoiceStatus.SUBMITTED] } },
      data: { status: PaymentInvoiceStatus.CANCELLED }
    });
    const created = await tx.paymentInvoice.create({
      data: { vendorId, planVersionId: version.id, accessTokenHash: paymentTokenHash(token), amountCents: version.monthlyPriceCents!, currency: version.currency, destinationPhone: env.TELEBIRR_PAYMENT_PHONE, expiresAt: paymentInvoiceExpiry() }
    });
    await tx.auditLog.create({ data: { vendorId, action: "subscription_payment_invoice_created", entityType: "PaymentInvoice", entityId: created.id, metadata: { planCode: plan.code, planVersionId: version.id, amountCents: version.monthlyPriceCents } } });
    return created;
  });
  publishLiveEvent(vendorId, ["billing", "logs"]);
  return { invoiceId: invoice.id, token };
}

export async function reviewPayment(invoiceId: string, reviewerId: string, decision: "approve" | "reject", note?: string) {
  const result = await prisma.$transaction(async (tx) => {
    const invoice = await tx.paymentInvoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new Error("Payment invoice not found");
    if (invoice.status !== PaymentInvoiceStatus.REVIEW) throw new Error("Only payments awaiting review can be decided");
    const reviewedAt = new Date();
    if (decision === "reject") {
      await tx.paymentInvoice.update({ where: { id: invoice.id }, data: { status: PaymentInvoiceStatus.CANCELLED, reviewNote: note, reviewedAt, reviewedById: reviewerId } });
      await tx.auditLog.create({ data: { vendorId: invoice.vendorId, actorUserId: reviewerId, action: "telebirr_payment_proof_rejected", entityType: "PaymentInvoice", entityId: invoice.id, metadata: { note } } });
      return { status: PaymentInvoiceStatus.CANCELLED, vendorId: invoice.vendorId };
    }
    const periodEnd = new Date(reviewedAt);
    periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
    await tx.paymentInvoice.update({ where: { id: invoice.id }, data: { status: PaymentInvoiceStatus.PAID, paidAt: reviewedAt, reviewNote: note, reviewedAt, reviewedById: reviewerId } });
    await tx.vendorSubscription.upsert({
      where: { vendorId: invoice.vendorId },
      update: { planVersionId: invoice.planVersionId, status: SubscriptionStatus.ACTIVE, provider: "telebirr_proof", providerSubscriptionId: `proof:${invoice.id}`, currentPeriodStart: reviewedAt, currentPeriodEnd: periodEnd, cancelAtPeriodEnd: false },
      create: { vendorId: invoice.vendorId, planVersionId: invoice.planVersionId, status: SubscriptionStatus.ACTIVE, provider: "telebirr_proof", providerSubscriptionId: `proof:${invoice.id}`, currentPeriodStart: reviewedAt, currentPeriodEnd: periodEnd }
    });
    await applyPlanCapabilityState(tx, invoice.vendorId, invoice.planVersionId);
    await tx.auditLog.create({ data: { vendorId: invoice.vendorId, actorUserId: reviewerId, action: "telebirr_payment_proof_approved", entityType: "PaymentInvoice", entityId: invoice.id, metadata: { note, amountCents: invoice.amountCents } } });
    return { status: PaymentInvoiceStatus.PAID, vendorId: invoice.vendorId };
  });
  publishLiveEvent(result.vendorId, ["billing", "vendor", "logs"]);
  return result;
}

const invoiceInclude = {
  vendor: { select: { id: true, name: true, email: true } },
  planVersion: { select: { id: true, currency: true, plan: { select: { code: true, name: true } } } }
} as const;

type PublicInvoice = Prisma.PaymentInvoiceGetPayload<{ include: typeof invoiceInclude }>;

export function serializePaymentInvoice(invoice: PublicInvoice) {
  return {
    id: invoice.id,
    businessName: invoice.vendor.name,
    ownerEmail: invoice.vendor.email,
    plan: invoice.planVersion.plan,
    amountCents: invoice.amountCents,
    currency: invoice.currency,
    destinationPhone: invoice.destinationPhone,
    status: invoice.status,
    claimedTransactionId: invoice.claimedTransactionId,
    submittedAt: invoice.submittedAt,
    proofUploadedAt: invoice.proofUploadedAt,
    expiresAt: invoice.expiresAt,
    paidAt: invoice.paidAt
  };
}

async function settleMatch(tx: Prisma.TransactionClient, invoiceId: string, smsId: string) {
  const invoice = await tx.paymentInvoice.findUnique({ where: { id: invoiceId } });
  const sms = await tx.telebirrSmsEvent.findUnique({ where: { id: smsId } });
  if (!invoice || !sms) throw new Error("Payment record is missing");
  if (invoice.status === PaymentInvoiceStatus.PAID) return "PAID" as const;
  if (invoice.expiresAt <= new Date()) {
    await tx.paymentInvoice.update({ where: { id: invoice.id }, data: { status: PaymentInvoiceStatus.EXPIRED } });
    return "EXPIRED" as const;
  }
  if (invoice.claimedTransactionId !== sms.transactionId) return "WAITING" as const;

  if (invoice.amountCents !== sms.amountCents || invoice.currency !== sms.currency) {
    await tx.paymentInvoice.update({ where: { id: invoice.id }, data: { status: PaymentInvoiceStatus.REVIEW } });
    await tx.telebirrSmsEvent.update({ where: { id: sms.id }, data: { status: PaymentSmsStatus.REVIEW, matchedInvoiceId: invoice.id } });
    await tx.auditLog.create({
      data: { vendorId: invoice.vendorId, action: "telebirr_payment_amount_mismatch", entityType: "PaymentInvoice", entityId: invoice.id, metadata: { expectedAmountCents: invoice.amountCents, receivedAmountCents: sms.amountCents, transactionId: sms.transactionId } }
    });
    return "REVIEW" as const;
  }

  const paidAt = new Date();
  const periodEnd = new Date(paidAt);
  periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
  await tx.paymentInvoice.update({ where: { id: invoice.id }, data: { status: PaymentInvoiceStatus.PAID, paidAt } });
  await tx.telebirrSmsEvent.update({ where: { id: sms.id }, data: { status: PaymentSmsStatus.MATCHED, matchedInvoiceId: invoice.id } });
  await tx.vendorSubscription.update({
    where: { vendorId: invoice.vendorId },
    data: { planVersionId: invoice.planVersionId, status: SubscriptionStatus.ACTIVE, provider: "telebirr_sms", providerSubscriptionId: sms.transactionId, currentPeriodStart: paidAt, currentPeriodEnd: periodEnd, cancelAtPeriodEnd: false }
  });
  await applyPlanCapabilityState(tx, invoice.vendorId, invoice.planVersionId);
  await tx.auditLog.create({
    data: { vendorId: invoice.vendorId, action: "telebirr_payment_verified", entityType: "PaymentInvoice", entityId: invoice.id, metadata: { amountCents: sms.amountCents, currency: sms.currency, transactionId: sms.transactionId } }
  });
  return "PAID" as const;
}

export async function getPaymentInvoice(id: string, token: string) {
  const invoice = await prisma.paymentInvoice.findFirst({ where: { id, accessTokenHash: paymentTokenHash(token) }, include: invoiceInclude });
  if (!invoice) return null;
  if (invoice.expiresAt <= new Date() && invoice.status !== PaymentInvoiceStatus.PAID && invoice.status !== PaymentInvoiceStatus.EXPIRED) {
    return serializePaymentInvoice(await prisma.paymentInvoice.update({ where: { id }, data: { status: PaymentInvoiceStatus.EXPIRED }, include: invoiceInclude }));
  }
  return serializePaymentInvoice(invoice);
}

export async function claimPayment(invoiceId: string, token: string, rawTransactionId: string) {
  const transactionId = normalizeTransactionId(rawTransactionId);
  if (!/^[A-Z0-9]{6,32}$/.test(transactionId)) throw new Error("Enter a valid Telebirr transaction number");
  const result = await prisma.$transaction(async (tx) => {
    const invoice = await tx.paymentInvoice.findFirst({ where: { id: invoiceId, accessTokenHash: paymentTokenHash(token) } });
    if (!invoice) throw new Error("Payment request not found");
    if (invoice.status === PaymentInvoiceStatus.PAID) return "PAID" as const;
    if (invoice.status === PaymentInvoiceStatus.REVIEW && invoice.proofUploadedAt) return "REVIEW" as const;
    if (invoice.expiresAt <= new Date()) {
      await tx.paymentInvoice.update({ where: { id: invoice.id }, data: { status: PaymentInvoiceStatus.EXPIRED } });
      return "EXPIRED" as const;
    }
    const retryAvailable = invoice.status === PaymentInvoiceStatus.SUBMITTED
      && invoice.submittedAt
      && invoice.submittedAt.getTime() <= Date.now() - 20_000;
    if (invoice.claimedTransactionId && invoice.claimedTransactionId !== transactionId && !retryAvailable) {
      throw new Error("Wait 20 seconds before trying a different transaction number");
    }
    await tx.paymentInvoice.update({ where: { id: invoice.id }, data: { claimedTransactionId: transactionId, submittedAt: new Date(), status: PaymentInvoiceStatus.SUBMITTED } });
    const sms = await tx.telebirrSmsEvent.findUnique({ where: { transactionId } });
    if (!sms) return "SUBMITTED" as const;
    return settleMatch(tx, invoice.id, sms.id);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  const invoice = await prisma.paymentInvoice.findUnique({ where: { id: invoiceId }, select: { vendorId: true } });
  publishLiveEvent(invoice?.vendorId, ["billing", "vendor", "logs"]);
  return result;
}

export async function uploadPaymentProof(invoiceId: string, token: string, file: { buffer: Buffer; mimetype: string; originalname: string }) {
  const validSignature = file.mimetype === "image/jpeg" ? file.buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
    : file.mimetype === "image/png" ? file.buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      : file.mimetype === "image/webp" ? file.buffer.subarray(0, 4).toString("ascii") === "RIFF" && file.buffer.subarray(8, 12).toString("ascii") === "WEBP"
        : file.mimetype === "application/pdf" ? file.buffer.subarray(0, 5).toString("ascii") === "%PDF-"
          : false;
  if (!validSignature) throw new Error("The uploaded file content does not match its file type");
  const invoice = await prisma.paymentInvoice.findFirst({ where: { id: invoiceId, accessTokenHash: paymentTokenHash(token) } });
  if (!invoice) throw new Error("Payment request not found");
  if (invoice.status === PaymentInvoiceStatus.PAID) return "PAID" as const;
  if (invoice.status === PaymentInvoiceStatus.EXPIRED || invoice.status === PaymentInvoiceStatus.CANCELLED) {
    throw new Error("This payment request is no longer active");
  }
  await prisma.$transaction(async (tx) => {
    await tx.paymentInvoice.update({
      where: { id: invoice.id },
      data: { proofData: file.buffer, proofMimeType: file.mimetype, proofFileName: file.originalname.slice(0, 180), proofUploadedAt: new Date(), status: PaymentInvoiceStatus.REVIEW }
    });
    await tx.auditLog.create({
      data: { vendorId: invoice.vendorId, action: "telebirr_payment_proof_uploaded", entityType: "PaymentInvoice", entityId: invoice.id, metadata: { fileName: file.originalname.slice(0, 180), mimeType: file.mimetype, size: file.buffer.length } }
    });
  });
  publishLiveEvent(invoice.vendorId, ["billing", "logs"]);
  return "REVIEW" as const;
}

export async function ingestTelebirrSms(input: { sender: string; message: string; deviceId?: string }) {
  if (input.sender.trim() !== "127") throw new Error("Only Telebirr messages from sender 127 are accepted");
  const parsed = parseTelebirrCredit(input.message);
  const messageHash = crypto.createHash("sha256").update(input.message.trim()).digest("hex");
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.telebirrSmsEvent.findFirst({ where: { OR: [{ messageHash }, { transactionId: parsed.transactionId }] } });
    if (existing) return { duplicate: true, transactionId: existing.transactionId, status: existing.status };
    const sms = await tx.telebirrSmsEvent.create({
      data: { sender: "127", deviceId: input.deviceId, messageHash, encryptedMessage: encryptSecret(input.message), ...parsed }
    });
    const invoice = await tx.paymentInvoice.findUnique({ where: { claimedTransactionId: parsed.transactionId } });
    if (!invoice) return { duplicate: false, transactionId: sms.transactionId, status: "RECEIVED" as const };
    return { duplicate: false, transactionId: sms.transactionId, status: await settleMatch(tx, invoice.id, sms.id) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  const invoice = await prisma.paymentInvoice.findUnique({ where: { claimedTransactionId: result.transactionId }, select: { vendorId: true } });
  publishLiveEvent(invoice?.vendorId, ["billing", "vendor", "logs"]);
  return result;
}
