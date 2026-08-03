ALTER TABLE "User"
ADD COLUMN "phoneVerifiedAt" TIMESTAMP(3),
ADD COLUMN "telegramVerifiedAt" TIMESTAMP(3),
ADD COLUMN "telegramUserId" TEXT,
ADD COLUMN "telegramUsername" TEXT,
ADD COLUMN "telegramName" TEXT;

ALTER TABLE "TelegramVerificationSession"
ADD COLUMN "userId" TEXT;

CREATE INDEX "TelegramVerificationSession_userId_idx" ON "TelegramVerificationSession"("userId");
