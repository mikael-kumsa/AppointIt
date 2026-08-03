import { describe, expect, it } from "vitest";
import { AppointmentStatus } from "@prisma/client";
import { assertAppointmentTransition } from "../src/modules/appointments/appointment-status.js";

describe("appointment status transitions", () => {
  const past = new Date("2026-07-03T08:00:00Z");
  const future = new Date("2026-07-03T12:00:00Z");
  const now = new Date("2026-07-03T10:00:00Z");

  it("allows active appointments to be cancelled", () => {
    expect(() => assertAppointmentTransition(AppointmentStatus.CONFIRMED, AppointmentStatus.CANCELLED, future, now)).not.toThrow();
  });

  it("rejects changes from terminal states", () => {
    expect(() => assertAppointmentTransition(AppointmentStatus.CANCELLED, AppointmentStatus.COMPLETED, past, now)).toThrow(/cannot be changed/);
  });

  it("rejects completion and no-show before the start time", () => {
    expect(() => assertAppointmentTransition(AppointmentStatus.CONFIRMED, AppointmentStatus.COMPLETED, future, now)).toThrow(/after the appointment starts/);
    expect(() => assertAppointmentTransition(AppointmentStatus.CONFIRMED, AppointmentStatus.NO_SHOW, future, now)).toThrow(/after the appointment starts/);
  });
});
