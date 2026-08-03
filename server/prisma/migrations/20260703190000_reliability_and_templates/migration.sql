ALTER TABLE "Customer" ADD COLUMN "smsOptIn" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Vendor" ADD COLUMN "description" TEXT;

ALTER TABLE "MessageTemplate"
  ADD COLUMN "subject" TEXT,
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

DELETE FROM "MessageTemplate" older
USING "MessageTemplate" newer
WHERE older."vendorId" = newer."vendorId"
  AND older."channel" = newer."channel"
  AND older."type" = newer."type"
  AND older."id" < newer."id";

CREATE UNIQUE INDEX "MessageTemplate_vendorId_channel_type_key"
  ON "MessageTemplate"("vendorId", "channel", "type");

ALTER TABLE "NotificationLog"
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastAttemptAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "NotificationLog_idempotencyKey_key"
  ON "NotificationLog"("idempotencyKey");
