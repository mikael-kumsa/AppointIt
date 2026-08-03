import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db.js", () => ({
  prisma: {
    appointment: { findUnique: vi.fn() },
    activityNotification: { create: vi.fn() }
  }
}));
vi.mock("../src/modules/live/live-events.js", () => ({ publishLiveEvent: vi.fn() }));

import { prisma } from "../src/db.js";
import { publishLiveEvent } from "../src/modules/live/live-events.js";
import { recordAppointmentActivity } from "../src/modules/activity/activity.service.js";

describe("activity notifications", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stores a tenant-scoped booking activity and publishes it live", async () => {
    vi.mocked(prisma.appointment.findUnique).mockResolvedValue({
      id: "appointment-1",
      vendorId: "vendor-1",
      startAt: new Date("2026-07-05T08:00:00Z"),
      customer: { name: "Marta" },
      service: { name: "Consultation" },
      vendor: { timezone: "Africa/Addis_Ababa" }
    } as any);
    vi.mocked(prisma.activityNotification.create).mockResolvedValue({ id: "activity-1" } as any);

    await recordAppointmentActivity("appointment-1", "new_booking");

    expect(prisma.activityNotification.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      vendorId: "vendor-1",
      appointmentId: "appointment-1",
      type: "new_booking",
      title: "New booking"
    }) });
    expect(publishLiveEvent).toHaveBeenCalledWith("vendor-1", ["activity"]);
  });
});
