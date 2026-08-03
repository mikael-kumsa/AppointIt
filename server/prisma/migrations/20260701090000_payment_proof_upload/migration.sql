ALTER TABLE "PaymentInvoice"
ADD COLUMN "proofData" BYTEA,
ADD COLUMN "proofMimeType" TEXT,
ADD COLUMN "proofFileName" TEXT,
ADD COLUMN "proofUploadedAt" TIMESTAMP(3);
