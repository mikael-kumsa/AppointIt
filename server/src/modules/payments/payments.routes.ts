import { Router } from "express";
import multer from "multer";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { claimPayment, createVendorPaymentInvoice, getPaymentInvoice, reviewPayment, uploadPaymentProof } from "./payments.service.js";
import { sendPlatformEmail } from "../notifications/email.service.js";
import { verifyRenewalToken } from "../auth/auth.service.js";

export const paymentsRouter = Router();
const allowedProofTypes = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const proofUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!allowedProofTypes.has(file.mimetype)) return callback(new Error("Upload a JPG, PNG, WebP, or PDF file"));
    return callback(null, true);
  }
});
const receiveProof: import("express").RequestHandler = (req, res, next) => {
  proofUpload.single("proof")(req, res, (error) => error ? res.status(400).json({ error: error.message }) : next());
};

paymentsRouter.get("/invoices/:id", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  if (token.length < 32) return res.status(404).json({ error: "Payment request not found" });
  const invoice = await getPaymentInvoice(String(req.params.id), token);
  if (!invoice) return res.status(404).json({ error: "Payment request not found" });
  return res.json(invoice);
});

paymentsRouter.post("/invoices/:id/claim", validateBody(z.object({ token: z.string().min(32), transactionId: z.string().min(6).max(32) })), async (req, res) => {
  try {
    const status = await claimPayment(String(req.params.id), req.body.token, req.body.transactionId);
    return res.json({ status });
  } catch (error) {
    return res.status(409).json({ error: error instanceof Error ? error.message : "Payment could not be submitted" });
  }
});

paymentsRouter.post("/invoices/:id/proof", receiveProof, async (req, res) => {
  const token = typeof req.body?.token === "string" ? req.body.token : "";
  if (token.length < 32 || !req.file) return res.status(400).json({ error: "Payment token and proof file are required" });
  try {
    return res.json({ status: await uploadPaymentProof(String(req.params.id), token, req.file) });
  } catch (error) {
    return res.status(409).json({ error: error instanceof Error ? error.message : "Payment proof could not be uploaded" });
  }
});

paymentsRouter.get("/invoices/:id/proof", requireAuth, requireRole(UserRole.SUPER_ADMIN), async (req, res) => {
  const invoice = await prisma.paymentInvoice.findUnique({ where: { id: String(req.params.id) }, select: { proofData: true, proofMimeType: true, proofFileName: true } });
  if (!invoice?.proofData || !invoice.proofMimeType) return res.status(404).json({ error: "Payment proof not found" });
  res.type(invoice.proofMimeType);
  res.setHeader("Content-Disposition", `inline; filename="${(invoice.proofFileName ?? "payment-proof").replace(/["\\\r\n]/g, "_")}"`);
  return res.send(invoice.proofData);
});

paymentsRouter.post("/subscription/invoice", requireAuth, requireRole(UserRole.VENDOR_ADMIN), validateBody(z.object({ planId: z.string().min(1) })), async (req, res) => {
  if (!req.user?.vendorId) return res.status(403).json({ error: "Missing tenant" });
  try {
    return res.status(201).json(await createVendorPaymentInvoice(req.user.vendorId, req.body.planId));
  } catch (error) {
    return res.status(409).json({ error: error instanceof Error ? error.message : "Could not create payment invoice" });
  }
});

paymentsRouter.post("/subscription/renewal-invoice", validateBody(z.object({ renewalToken: z.string().min(20), planId: z.string().min(1) })), async (req, res) => {
  try {
    const renewal = verifyRenewalToken(req.body.renewalToken);
    return res.status(201).json(await createVendorPaymentInvoice(renewal.vendorId, req.body.planId));
  } catch (error) {
    return res.status(401).json({ error: error instanceof Error ? error.message : "Renewal session expired" });
  }
});

paymentsRouter.post("/invoices/:id/review", requireAuth, requireRole(UserRole.SUPER_ADMIN), validateBody(z.object({ decision: z.enum(["approve", "reject"]), note: z.string().trim().max(1000).optional() })), async (req, res) => {
  try {
    const result = await reviewPayment(String(req.params.id), req.user!.id, req.body.decision, req.body.note);
    const vendor = await prisma.vendor.findUnique({ where: { id: result.vendorId }, select: { name: true, email: true } });
    if (vendor?.email) {
      const approved = req.body.decision === "approve";
      void sendPlatformEmail({ to: vendor.email, subject: approved ? "Your AppointIt payment was approved" : "Action needed for your AppointIt payment", text: approved ? `Hello ${vendor.name},\n\nYour payment proof was approved and your subscription is active.` : `Hello ${vendor.name},\n\nWe could not approve your payment proof.${req.body.note ? `\n\nReason: ${req.body.note}` : ""}` }).catch(() => undefined);
    }
    return res.json(result);
  } catch (error) {
    return res.status(409).json({ error: error instanceof Error ? error.message : "Payment review failed" });
  }
});

paymentsRouter.get("/", requireAuth, requireRole(UserRole.SUPER_ADMIN), async (_req, res) => {
  const payments = await prisma.paymentInvoice.findMany({
    select: {
      id: true, amountCents: true, currency: true, status: true, claimedTransactionId: true, proofUploadedAt: true, reviewNote: true, reviewedAt: true, createdAt: true, paidAt: true,
      vendor: { select: { id: true, name: true, email: true } },
      planVersion: { select: { plan: { select: { code: true, name: true } } } }
    },
    orderBy: { createdAt: "desc" }, take: 200
  });
  return res.json(payments.map((payment) => ({ id: payment.id, vendor: payment.vendor, plan: payment.planVersion.plan, amountCents: payment.amountCents, currency: payment.currency, status: payment.status, transactionId: payment.claimedTransactionId, hasProof: Boolean(payment.proofUploadedAt), reviewNote: payment.reviewNote, reviewedAt: payment.reviewedAt, createdAt: payment.createdAt, paidAt: payment.paidAt })));
});
