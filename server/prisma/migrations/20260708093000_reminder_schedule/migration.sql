CREATE TYPE "ReminderScheduleStatus" AS ENUM ('SCHEDULED', 'QUEUED', 'SENT', 'FAILED', 'SKIPPED', 'CANCELLED');

ALTER TABLE "NotificationLog" ADD COLUMN "scheduledFor" TIMESTAMP(3);

CREATE TABLE "ReminderSchedule" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "notificationLogId" TEXT,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'SMS',
    "type" TEXT NOT NULL,
    "offsetMinutes" INTEGER NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" "ReminderScheduleStatus" NOT NULL DEFAULT 'SCHEDULED',
    "jobId" TEXT NOT NULL,
    "skipReason" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReminderSchedule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReminderSchedule_jobId_key" ON "ReminderSchedule"("jobId");
CREATE INDEX "ReminderSchedule_vendorId_scheduledFor_idx" ON "ReminderSchedule"("vendorId", "scheduledFor");
CREATE INDEX "ReminderSchedule_appointmentId_status_idx" ON "ReminderSchedule"("appointmentId", "status");

ALTER TABLE "ReminderSchedule" ADD CONSTRAINT "ReminderSchedule_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReminderSchedule" ADD CONSTRAINT "ReminderSchedule_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReminderSchedule" ADD CONSTRAINT "ReminderSchedule_notificationLogId_fkey" FOREIGN KEY ("notificationLogId") REFERENCES "NotificationLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;
