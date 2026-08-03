import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const add = vi.fn();
const getJob = vi.fn();
const remove = vi.fn();

vi.mock("bullmq", () => ({
  Queue: vi.fn().mockImplementation(() => ({
    add,
    getJob,
    on: vi.fn()
  }))
}));

vi.mock("../src/db.js", () => ({
  prisma: {
    appointment: {
      findUnique: vi.fn()
    }
  }
}));

import { prisma } from "../src/db.js";
import { cancelAppointmentReminderJobs, scheduleAppointmentFollowUp, scheduleAppointmentReminders } from "../src/modules/notifications/notification.queue.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-26T09:00:00Z"));
  getJob.mockResolvedValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("notification queue scheduling", () => {
  it("schedules reminder jobs relative to appointment start time", async () => {
    vi.mocked(prisma.appointment.findUnique).mockResolvedValue({
      startAt: new Date("2026-07-10T09:00:00Z"),
      vendor: { settings: { reminderSettings: { automaticEnabled: true, offsetsMinutes: [10_080, 1440, 60] } } }
    } as any);

    await scheduleAppointmentReminders("appt-1");

    expect(add).toHaveBeenCalledWith(
      "appointment-reminder",
      { appointmentId: "appt-1", type: "reminder_10080m", notificationKey: "appointment:appt-1:reminder-10080m" },
      expect.objectContaining({ delay: 7 * 24 * 60 * 60 * 1000, jobId: "appointment:appt-1:reminder-10080m" })
    );
    expect(add).toHaveBeenCalledWith(
      "appointment-reminder",
      { appointmentId: "appt-1", type: "reminder_60m", notificationKey: "appointment:appt-1:reminder-60m" },
      expect.objectContaining({ delay: (14 * 24 - 1) * 60 * 60 * 1000, jobId: "appointment:appt-1:reminder-60m" })
    );
    expect(add).toHaveBeenCalledTimes(3);
  });

  it("removes reminder and follow-up jobs on cleanup", async () => {
    getJob.mockResolvedValue({ remove });

    await cancelAppointmentReminderJobs("appt-1", [1440, 60]);

    expect(getJob).toHaveBeenCalledWith("appointment:appt-1:reminder_24h");
    expect(getJob).toHaveBeenCalledWith("appointment:appt-1:reminder_2h");
    expect(getJob).toHaveBeenCalledWith("appointment:appt-1:reminder-1440m");
    expect(getJob).toHaveBeenCalledWith("appointment:appt-1:reminder-60m");
    expect(getJob).toHaveBeenCalledWith("appointment:appt-1:follow_up");
    expect(remove).toHaveBeenCalledTimes(5);
  });

  it("does not schedule automatic jobs in manual-only mode", async () => {
    vi.mocked(prisma.appointment.findUnique).mockResolvedValue({
      startAt: new Date("2026-07-10T09:00:00Z"),
      vendor: { settings: { reminderSettings: { automaticEnabled: false, offsetsMinutes: [1440] } } }
    } as any);

    await scheduleAppointmentReminders("appt-1");

    expect(add).not.toHaveBeenCalled();
  });

  it("schedules follow-up one hour after completion", async () => {
    await scheduleAppointmentFollowUp("appt-1");

    expect(add).toHaveBeenCalledWith(
      "appointment-notification",
      { appointmentId: "appt-1", type: "follow_up", notificationKey: "appointment:appt-1:follow_up" },
      expect.objectContaining({ delay: 60 * 60 * 1000, jobId: "appointment:appt-1:follow_up" })
    );
  });
});
