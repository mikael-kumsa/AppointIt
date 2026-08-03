-- AlterEnum
ALTER TYPE "NotificationChannel" ADD VALUE 'SMS';

-- AlterTable
ALTER TABLE "MessageSetting" ADD COLUMN "smsEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "smsProvider" TEXT,
ADD COLUMN "smsGatewayUrl" TEXT,
ADD COLUMN "encryptedSmsGatewayApiKey" TEXT,
ADD COLUMN "smsFrom" TEXT;
