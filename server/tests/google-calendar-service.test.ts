import { beforeEach, describe, expect, it, vi } from "vitest";
import { LogStatus } from "@prisma/client";
import { encryptSecret } from "../src/utils/crypto.js";

vi.mock("../src/db.js", () => ({
  prisma: {
    appointment: {
      findUniqueOrThrow: vi.fn(),
      update: vi.fn()
    },
    calendarConnection: {
      findFirst: vi.fn(),
      update: vi.fn()
    },
    calendarSyncLog: {
      create: vi.fn()
    }
  }
}));

import { prisma } from "../src/db.js";
import { syncAppointmentToGoogle } from "../src/modules/calendar/google-calendar.service.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
});

describe("syncAppointmentToGoogle", () => {
  it("creates a Google Calendar event and stores its external event id", async () => {
    vi.mocked(prisma.appointment.findUniqueOrThrow).mockResolvedValue({
      id: "appt-1",
      vendorId: "vendor-1",
      staffId: "staff-1",
      customerId: "customer-1",
      startAt: new Date("2026-06-26T09:00:00Z"),
      endAt: new Date("2026-06-26T09:45:00Z"),
      notes: "Bring insurance card",
      googleCalendarEventId: null,
      vendor: { id: "vendor-1", name: "Addis Dental Clinic", timezone: "Africa/Addis_Ababa" },
      branch: { name: "Bole", address: "Bole, Addis Ababa" },
      customer: { name: "Mekdes Alemu", phone: "+251911000001", email: "mekdes@example.com" },
      service: { name: "Dental Cleaning" },
      staff: { name: "Dr. Hana" }
    } as any);
    vi.mocked(prisma.calendarConnection.findFirst).mockResolvedValue({
      id: "calendar-1",
      vendorId: "vendor-1",
      staffId: null,
      provider: "google",
      calendarId: "primary",
      encryptedAccessToken: encryptSecret("access-token"),
      encryptedRefreshToken: null,
      expiresAt: new Date(Date.now() + 3600_000),
      syncEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "google-event-1" })
    } as Response);
    vi.mocked(prisma.appointment.update).mockResolvedValue({ id: "appt-1", googleCalendarEventId: "google-event-1" } as any);
    vi.mocked(prisma.calendarSyncLog.create).mockResolvedValue({ id: "log-1" } as any);

    await syncAppointmentToGoogle("appt-1", "create");

    expect(fetch).toHaveBeenCalledWith(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=none",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer access-token" })
      })
    );
    expect(prisma.appointment.update).toHaveBeenCalledWith({
      where: { id: "appt-1" },
      data: { googleCalendarEventId: "google-event-1" }
    });
    expect(prisma.calendarSyncLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        vendorId: "vendor-1",
        appointmentId: "appt-1",
        provider: "google",
        action: "create_event",
        status: LogStatus.SENT
      })
    });
  });
});
