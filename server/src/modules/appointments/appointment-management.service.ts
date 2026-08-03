import jwt from "jsonwebtoken";
import { AppointmentStatus, Prisma } from "@prisma/client";
import { env } from "../../config/env.js";
import { prisma } from "../../db.js";

export type AppointmentRules = {
  allowCustomerCancellation: boolean;
  allowCustomerReschedule: boolean;
  cancellationNoticeHours: number;
  rescheduleNoticeHours: number;
  maxCustomerReschedules: number;
};

export const defaultAppointmentRules: AppointmentRules = {
  allowCustomerCancellation: true,
  allowCustomerReschedule: true,
  cancellationNoticeHours: 2,
  rescheduleNoticeHours: 2,
  maxCustomerReschedules: 3
};

export function appointmentRules(settings: Prisma.JsonValue | null | undefined): AppointmentRules {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return defaultAppointmentRules;
  const stored = (settings as Record<string, unknown>).appointmentRules;
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return defaultAppointmentRules;
  const values = stored as Record<string, unknown>;
  return {
    allowCustomerCancellation: typeof values.allowCustomerCancellation === "boolean" ? values.allowCustomerCancellation : defaultAppointmentRules.allowCustomerCancellation,
    allowCustomerReschedule: typeof values.allowCustomerReschedule === "boolean" ? values.allowCustomerReschedule : defaultAppointmentRules.allowCustomerReschedule,
    cancellationNoticeHours: typeof values.cancellationNoticeHours === "number" ? values.cancellationNoticeHours : defaultAppointmentRules.cancellationNoticeHours,
    rescheduleNoticeHours: typeof values.rescheduleNoticeHours === "number" ? values.rescheduleNoticeHours : defaultAppointmentRules.rescheduleNoticeHours,
    maxCustomerReschedules: typeof values.maxCustomerReschedules === "number" ? values.maxCustomerReschedules : defaultAppointmentRules.maxCustomerReschedules
  };
}

export function signAppointmentManagementToken(appointment: { id: string; endAt: Date; managementTokenVersion: number }) {
  const expiresAt = Math.floor((appointment.endAt.getTime() + 30 * 24 * 60 * 60 * 1000) / 1000);
  return jwt.sign({ scope: "appointment_management", appointmentId: appointment.id, version: appointment.managementTokenVersion, exp: expiresAt }, env.JWT_ACCESS_SECRET);
}

export async function managedAppointment(token: string) {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as { scope?: string; appointmentId?: string; version?: number };
  if (payload.scope !== "appointment_management" || !payload.appointmentId || !Number.isInteger(payload.version)) throw new Error("Invalid booking management link");
  const appointment = await prisma.appointment.findUnique({
    where: { id: payload.appointmentId },
    include: { customer: true, service: true, staff: true, branch: true, vendor: true, history: { orderBy: { createdAt: "desc" } } }
  });
  if (!appointment || appointment.managementTokenVersion !== payload.version) throw new Error("This booking management link is no longer valid");
  return appointment;
}

export function customerManagementCapabilities(appointment: Awaited<ReturnType<typeof managedAppointment>>) {
  const rules = appointmentRules(appointment.vendor.settings);
  const hoursUntilStart = (appointment.startAt.getTime() - Date.now()) / 3_600_000;
  const terminal = [AppointmentStatus.CANCELLED, AppointmentStatus.COMPLETED, AppointmentStatus.NO_SHOW].includes(appointment.status as "CANCELLED" | "COMPLETED" | "NO_SHOW");
  const customerReschedules = appointment.history.filter((item) => item.action === "customer_rescheduled").length;
  const cancellationDeadline = new Date(appointment.startAt.getTime() - rules.cancellationNoticeHours * 3_600_000);
  const rescheduleDeadline = new Date(appointment.startAt.getTime() - rules.rescheduleNoticeHours * 3_600_000);
  let cancelUnavailableReason: string | null = null;
  let rescheduleUnavailableReason: string | null = null;
  if (terminal) {
    cancelUnavailableReason = `This appointment is already ${appointment.status.toLowerCase().replace("_", "-")}.`;
    rescheduleUnavailableReason = cancelUnavailableReason;
  } else {
    if (!rules.allowCustomerCancellation) cancelUnavailableReason = "Online cancellation is disabled by this business.";
    else if (hoursUntilStart < rules.cancellationNoticeHours) cancelUnavailableReason = `Online cancellation closed ${rules.cancellationNoticeHours} hours before the appointment.`;
    if (!rules.allowCustomerReschedule) rescheduleUnavailableReason = "Online rescheduling is disabled by this business.";
    else if (hoursUntilStart < rules.rescheduleNoticeHours) rescheduleUnavailableReason = `Online rescheduling closed ${rules.rescheduleNoticeHours} hours before the appointment.`;
    else if (customerReschedules >= rules.maxCustomerReschedules) rescheduleUnavailableReason = `The limit of ${rules.maxCustomerReschedules} online reschedules has been reached.`;
  }
  return {
    rules,
    customerReschedules,
    cancellationDeadline,
    rescheduleDeadline,
    cancelUnavailableReason,
    rescheduleUnavailableReason,
    canCancel: cancelUnavailableReason === null,
    canReschedule: rescheduleUnavailableReason === null
  };
}
