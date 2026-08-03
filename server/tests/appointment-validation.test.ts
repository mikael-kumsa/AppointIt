import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppointmentSource, AppointmentStatus } from "@prisma/client";

const tx = {
  branch: { findFirst: vi.fn() },
  service: { findFirst: vi.fn() },
  appointment: { findFirstOrThrow: vi.fn(), update: vi.fn() },
  customer: { upsert: vi.fn(), update: vi.fn() }
};

vi.mock("../src/db.js", () => ({
  prisma: {
    $transaction: vi.fn(async (callback: (database: typeof tx) => unknown) => callback(tx))
  }
}));

vi.mock("../src/modules/availability/availability.service.js", () => ({
  findAvailableStaff: vi.fn()
}));

vi.mock("../src/modules/notifications/notification.queue.js", () => ({
  cancelAppointmentReminderJobs: vi.fn(),
  enqueueAppointmentNotifications: vi.fn(),
  scheduleAppointmentFollowUp: vi.fn(),
  scheduleAppointmentReminders: vi.fn()
}));

vi.mock("../src/modules/calendar/google-calendar.service.js", () => ({ syncAppointmentToGoogle: vi.fn() }));

import { prisma } from "../src/db.js";
import { findAvailableStaff } from "../src/modules/availability/availability.service.js";
import { createAppointment, rescheduleAppointment } from "../src/modules/appointments/appointments.service.js";

const baseInput = {
  vendorId: "vendor-1",
  branchId: "branch-1",
  serviceId: "service-1",
  customer: { name: "Test Client", phone: "+251911000000" },
  source: AppointmentSource.DASHBOARD
};

describe("appointment validation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects appointments in the past before opening a transaction", async () => {
    await expect(createAppointment({ ...baseInput, startAt: new Date("2020-01-01T09:00:00Z") })).rejects.toThrow("must be in the future");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a branch that is inactive or belongs to another tenant", async () => {
    tx.branch.findFirst.mockResolvedValue(null);
    tx.service.findFirst.mockResolvedValue({ id: "service-1" });
    await expect(createAppointment({ ...baseInput, startAt: new Date("2099-01-01T09:00:00Z") })).rejects.toThrow("active branch from this business");
    expect(findAvailableStaff).not.toHaveBeenCalled();
  });

  it("does not reschedule terminal appointments", async () => {
    tx.appointment.findFirstOrThrow.mockResolvedValue({
      id: "appointment-1",
      vendorId: "vendor-1",
      branchId: "branch-1",
      serviceId: "service-1",
      staffId: "staff-1",
      startAt: new Date("2098-01-01T09:00:00Z"),
      status: AppointmentStatus.CANCELLED
    });
    await expect(rescheduleAppointment("vendor-1", "appointment-1", new Date("2099-01-01T09:00:00Z"))).rejects.toThrow("cancelled appointment cannot be rescheduled");
    expect(findAvailableStaff).not.toHaveBeenCalled();
  });
});
