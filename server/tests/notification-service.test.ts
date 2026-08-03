import { beforeEach, describe, expect, it, vi } from "vitest";
import { LogStatus, NotificationChannel } from "@prisma/client";
import { encryptSecret } from "../src/utils/crypto.js";

vi.mock("../src/db.js", () => ({
  prisma: {
    appointment: {
      findUniqueOrThrow: vi.fn()
    },
    notificationLog: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn()
    }
  }
}));

vi.mock("../src/modules/notifications/email.service.js", () => ({
  sendPlatformEmail: vi.fn(async () => { throw new Error("SMTP is not configured"); })
}));

import { prisma } from "../src/db.js";
import { sendAppointmentNotification } from "../src/modules/notifications/notification.service.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
});

describe("sendAppointmentNotification", () => {
  it("records failed email notification when SMTP is not configured", async () => {
    vi.mocked(prisma.appointment.findUniqueOrThrow).mockResolvedValue({
      id: "appt-1",
      vendorId: "vendor-1",
      customerId: "customer-1",
      startAt: new Date("2026-06-26T09:00:00Z"),
      endAt: new Date("2026-06-26T10:00:00Z"),
      managementTokenVersion: 0,
      customer: {
        name: "Mekdes Alemu",
        email: "mekdes@example.com",
        phone: "+251911000001",
        smsOptIn: false
      },
      vendor: {
        name: "Addis Dental Clinic",
        timezone: "Africa/Addis_Ababa",
        messageSettings: null,
        messageTemplates: []
      },
      service: {
        name: "Dental Cleaning"
      },
      staff: {
        name: "Dr. Hana"
      },
      branch: {
        name: "Bole",
        address: "Bole Road"
      }
    } as any);
    vi.mocked(prisma.notificationLog.create).mockResolvedValue({ id: "log-1" } as any);
    vi.mocked(prisma.notificationLog.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.notificationLog.update).mockResolvedValue({ id: "log-1" } as any);

    await expect(sendAppointmentNotification("appt-1", "confirmation")).rejects.toThrow("SMTP is not configured");

    expect(prisma.notificationLog.update).toHaveBeenCalledWith({ where: { id: "log-1" }, data: expect.objectContaining({ status: LogStatus.FAILED, errorMessage: "SMTP is not configured" }) });
  });

  it("sends SMS through the configured HTTP gateway and logs delivery", async () => {
    vi.mocked(prisma.appointment.findUniqueOrThrow).mockResolvedValue({
      id: "appt-1",
      vendorId: "vendor-1",
      customerId: "customer-1",
      startAt: new Date("2026-06-26T09:00:00Z"),
      endAt: new Date("2026-06-26T10:00:00Z"),
      managementTokenVersion: 0,
      status: "CONFIRMED",
      customer: {
        name: "Mekdes Alemu",
        phone: "+251911000001",
        email: null,
        telegramId: null,
        smsOptIn: true
      },
      vendor: {
        name: "Addis Dental Clinic",
        timezone: "Africa/Addis_Ababa",
        messageTemplates: [],
        messageSettings: {
          smsEnabled: true,
          smsProvider: "http",
          smsGatewayUrl: "http://sms.local/send-sms",
          encryptedSmsGatewayApiKey: encryptSecret("sms-key"),
          smsFrom: "AppointIt"
        }
      },
      service: {
        name: "Dental Cleaning"
      },
      staff: {
        name: "Dr. Hana"
      },
      branch: {
        name: "Bole",
        address: "Bole Road"
      }
    } as any);
    vi.mocked(prisma.notificationLog.create).mockResolvedValue({ id: "log-1" } as any);
    vi.mocked(prisma.notificationLog.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.notificationLog.update).mockResolvedValue({ id: "log-1" } as any);
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ messageId: "sms-1" })
    } as Response);

    await sendAppointmentNotification("appt-1", "reminder_2h");

    expect(fetch).toHaveBeenCalledWith("http://sms.local/send-sms", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ authorization: "Bearer sms-key" })
    }));
    expect(prisma.notificationLog.update).toHaveBeenCalledWith({ where: { id: "log-1" }, data: expect.objectContaining({ status: LogStatus.SENT, providerMessageId: "sms-1" }) });
  });
});
