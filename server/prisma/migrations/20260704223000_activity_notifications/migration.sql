CREATE TABLE "ActivityNotification" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ActivityNotification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ActivityNotificationRead" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ActivityNotificationRead_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ActivityNotification_vendorId_createdAt_idx" ON "ActivityNotification"("vendorId", "createdAt");
CREATE UNIQUE INDEX "ActivityNotificationRead_notificationId_userId_key" ON "ActivityNotificationRead"("notificationId", "userId");
CREATE INDEX "ActivityNotificationRead_userId_readAt_idx" ON "ActivityNotificationRead"("userId", "readAt");

ALTER TABLE "ActivityNotification" ADD CONSTRAINT "ActivityNotification_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActivityNotification" ADD CONSTRAINT "ActivityNotification_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ActivityNotificationRead" ADD CONSTRAINT "ActivityNotificationRead_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "ActivityNotification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActivityNotificationRead" ADD CONSTRAINT "ActivityNotificationRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
