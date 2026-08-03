CREATE TYPE "VendorPlan" AS ENUM ('HOSTED', 'CUSTOM_DOMAIN');
CREATE TYPE "DomainStatus" AS ENUM ('PENDING', 'ACTIVE', 'FAILED', 'DISABLED');

ALTER TABLE "Vendor" ADD COLUMN "plan" "VendorPlan" NOT NULL DEFAULT 'HOSTED';
ALTER TABLE "Vendor" DROP COLUMN "planName";

CREATE TABLE "VendorDomain" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "status" "DomainStatus" NOT NULL DEFAULT 'PENDING',
    "sslStatus" TEXT NOT NULL DEFAULT 'pending',
    "provider" TEXT NOT NULL DEFAULT 'manual',
    "providerId" TEXT,
    "cnameTarget" TEXT NOT NULL,
    "verificationRecords" JSONB NOT NULL DEFAULT '[]',
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "verifiedAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorDomain_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VendorDomain_hostname_key" ON "VendorDomain"("hostname");
CREATE UNIQUE INDEX "VendorDomain_providerId_key" ON "VendorDomain"("providerId");
CREATE INDEX "VendorDomain_vendorId_status_idx" ON "VendorDomain"("vendorId", "status");

ALTER TABLE "VendorDomain" ADD CONSTRAINT "VendorDomain_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
