ALTER TABLE "Vendor"
ADD COLUMN "logoData" BYTEA,
ADD COLUMN "logoMimeType" TEXT,
ADD COLUMN "logoUpdatedAt" TIMESTAMP(3);

ALTER TABLE "Staff"
ADD COLUMN "profileImageData" BYTEA,
ADD COLUMN "profileImageMimeType" TEXT,
ADD COLUMN "profileImageUpdatedAt" TIMESTAMP(3);
