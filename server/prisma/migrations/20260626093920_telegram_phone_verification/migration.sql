-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "phoneVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "telegramName" TEXT,
ADD COLUMN     "telegramUserId" TEXT,
ADD COLUMN     "telegramUsername" TEXT,
ADD COLUMN     "telegramVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "TelegramVerificationSession" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "encryptedCodeVerifier" TEXT NOT NULL,
    "nonceHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramVerificationSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TelegramVerificationSession_stateHash_key" ON "TelegramVerificationSession"("stateHash");

-- CreateIndex
CREATE INDEX "TelegramVerificationSession_vendorId_idx" ON "TelegramVerificationSession"("vendorId");

-- CreateIndex
CREATE INDEX "TelegramVerificationSession_expiresAt_idx" ON "TelegramVerificationSession"("expiresAt");

-- AddForeignKey
ALTER TABLE "TelegramVerificationSession" ADD CONSTRAINT "TelegramVerificationSession_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
