CREATE TYPE "PaymentInvoiceStatus" AS ENUM ('PENDING', 'SUBMITTED', 'PAID', 'REVIEW', 'EXPIRED', 'CANCELLED');
CREATE TYPE "PaymentSmsStatus" AS ENUM ('RECEIVED', 'MATCHED', 'REVIEW');

CREATE TABLE "PaymentInvoice" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "planVersionId" TEXT NOT NULL,
  "accessTokenHash" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'ETB',
  "destinationPhone" TEXT NOT NULL,
  "status" "PaymentInvoiceStatus" NOT NULL DEFAULT 'PENDING',
  "claimedTransactionId" TEXT,
  "submittedAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentInvoice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TelebirrSmsEvent" (
  "id" TEXT NOT NULL,
  "sender" TEXT NOT NULL,
  "deviceId" TEXT,
  "messageHash" TEXT NOT NULL,
  "encryptedMessage" TEXT NOT NULL,
  "transactionId" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'ETB',
  "payerName" TEXT NOT NULL,
  "payerPhoneMasked" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" "PaymentSmsStatus" NOT NULL DEFAULT 'RECEIVED',
  "matchedInvoiceId" TEXT,
  CONSTRAINT "TelebirrSmsEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentInvoice_accessTokenHash_key" ON "PaymentInvoice"("accessTokenHash");
CREATE UNIQUE INDEX "PaymentInvoice_claimedTransactionId_key" ON "PaymentInvoice"("claimedTransactionId");
CREATE INDEX "PaymentInvoice_vendorId_status_idx" ON "PaymentInvoice"("vendorId", "status");
CREATE INDEX "PaymentInvoice_expiresAt_idx" ON "PaymentInvoice"("expiresAt");
CREATE UNIQUE INDEX "TelebirrSmsEvent_messageHash_key" ON "TelebirrSmsEvent"("messageHash");
CREATE UNIQUE INDEX "TelebirrSmsEvent_transactionId_key" ON "TelebirrSmsEvent"("transactionId");
CREATE UNIQUE INDEX "TelebirrSmsEvent_matchedInvoiceId_key" ON "TelebirrSmsEvent"("matchedInvoiceId");
CREATE INDEX "TelebirrSmsEvent_status_receivedAt_idx" ON "TelebirrSmsEvent"("status", "receivedAt");

ALTER TABLE "PaymentInvoice" ADD CONSTRAINT "PaymentInvoice_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentInvoice" ADD CONSTRAINT "PaymentInvoice_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "PlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TelebirrSmsEvent" ADD CONSTRAINT "TelebirrSmsEvent_matchedInvoiceId_fkey" FOREIGN KEY ("matchedInvoiceId") REFERENCES "PaymentInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
