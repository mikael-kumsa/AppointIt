import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppointmentStatus } from "@prisma/client";

vi.mock("../src/db.js", () => ({ prisma: { appointment: { findUnique: vi.fn() } } }));

import { prisma } from "../src/db.js";
import { appointmentRules, customerManagementCapabilities, managedAppointment, signAppointmentManagementToken } from "../src/modules/appointments/appointment-management.service.js";

function appointment(overrides: Record<string, unknown> = {}) {
  const startAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
  return {
    id: "appointment-1",
    startAt,
    endAt: new Date(startAt.getTime() + 30 * 60 * 1000),
    status: AppointmentStatus.CONFIRMED,
    managementTokenVersion: 0,
    vendor: { settings: {}, name: "Test Business", timezone: "Africa/Addis_Ababa" },
    customer: { name: "Customer" },
    service: { name: "Consultation" },
    staff: { name: "Provider" },
    branch: { name: "Main" },
    history: [],
    ...overrides
  } as any;
}

describe("appointment management links", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses conservative default customer change rules", () => {
    expect(appointmentRules({})).toEqual({
      allowCustomerCancellation: true,
      allowCustomerReschedule: true,
      cancellationNoticeHours: 2,
      rescheduleNoticeHours: 2,
      maxCustomerReschedules: 3
    });
  });

  it("signs a link and rejects it after its appointment version is revoked", async () => {
    const original = appointment();
    const token = signAppointmentManagementToken(original);
    vi.mocked(prisma.appointment.findUnique).mockResolvedValue({ ...original, managementTokenVersion: 1 });
    await expect(managedAppointment(token)).rejects.toThrow("no longer valid");
  });

  it("enforces notice periods and customer reschedule limits", () => {
    const nearStart = new Date(Date.now() + 60 * 60 * 1000);
    const item = appointment({
      startAt: nearStart,
      endAt: new Date(nearStart.getTime() + 30 * 60 * 1000),
      vendor: { settings: { appointmentRules: { cancellationNoticeHours: 2, rescheduleNoticeHours: 0, maxCustomerReschedules: 1 } } },
      history: [{ action: "customer_rescheduled" }]
    });
    const capabilities = customerManagementCapabilities(item);
    expect(capabilities.canCancel).toBe(false);
    expect(capabilities.canReschedule).toBe(false);
    expect(capabilities.customerReschedules).toBe(1);
    expect(capabilities.cancelUnavailableReason).toContain("2 hours");
    expect(capabilities.rescheduleUnavailableReason).toContain("limit of 1");
  });
});
