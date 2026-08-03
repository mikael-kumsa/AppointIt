-- Platform-level phone verification challenges.
CREATE TABLE "PhoneVerificationSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vendorId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "providerVerificationId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "resendAvailableAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sendCount" INTEGER NOT NULL DEFAULT 1,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhoneVerificationSession_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "MessageSetting" ADD COLUMN "smsIdentifierId" TEXT;

CREATE UNIQUE INDEX "PhoneVerificationSession_tokenHash_key" ON "PhoneVerificationSession"("tokenHash");
CREATE INDEX "PhoneVerificationSession_userId_createdAt_idx" ON "PhoneVerificationSession"("userId", "createdAt");
CREATE INDEX "PhoneVerificationSession_vendorId_idx" ON "PhoneVerificationSession"("vendorId");
CREATE INDEX "PhoneVerificationSession_expiresAt_idx" ON "PhoneVerificationSession"("expiresAt");
CREATE INDEX "NotificationLog_providerMessageId_idx" ON "NotificationLog"("providerMessageId");

ALTER TABLE "PhoneVerificationSession" ADD CONSTRAINT "PhoneVerificationSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PhoneVerificationSession" ADD CONSTRAINT "PhoneVerificationSession_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
