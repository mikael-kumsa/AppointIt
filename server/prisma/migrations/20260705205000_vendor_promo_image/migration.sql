ALTER TABLE "Vendor"
ADD COLUMN "promoImageData" BYTEA,
ADD COLUMN "promoImageMimeType" TEXT,
ADD COLUMN "promoImageUpdatedAt" TIMESTAMP(3);
