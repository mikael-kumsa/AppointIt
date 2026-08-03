import { AppointmentSource, AppointmentStatus, Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { findAvailableStaff } from "../availability/availability.service.js";
import { cancelAppointmentReminderJobs, enqueueAppointmentNotifications, scheduleAppointmentFollowUp, scheduleAppointmentReminders } from "../notifications/notification.queue.js";
import { assertAppointmentTransition } from "./appointment-status.js";
import { publishLiveEvent } from "../live/live-events.js";
import { recordAppointmentActivity } from "../activity/activity.service.js";
import { normalizePhoneNumber } from "../../utils/phone.js";

export type CreateAppointmentInput = {
  vendorId: string;
  branchId: string;
  serviceId: string;
  staffId?: string;
  customer: {
    name: string;
    phone: string;
    email?: string;
    smsOptIn?: boolean;
    whatsappOptIn?: boolean;
    telegramId?: string;
  };
  startAt: Date;
  source: AppointmentSource;
  notes?: string;
};

async function recordActivity(appointmentId: string, type: Parameters<typeof recordAppointmentActivity>[1]) {
  try {
    await recordAppointmentActivity(appointmentId, type);
  } catch (error) {
    console.error("Could not record appointment activity", { appointmentId, type, error });
  }
}

export async function createAppointment(input: CreateAppointmentInput) {
  if (input.startAt.getTime() <= Date.now()) throw new Error("Appointment time must be in the future");
  const customerPhone = normalizePhoneNumber(input.customer.phone);
  const appointment = await prisma.$transaction(async (tx) => {
    const [branch, service] = await Promise.all([
      tx.branch.findFirst({ where: { id: input.branchId, vendorId: input.vendorId, active: true }, select: { id: true } }),
      tx.service.findFirst({ where: { id: input.serviceId, vendorId: input.vendorId, active: true }, select: { id: true } })
    ]);
    if (!branch) throw new Error("Choose an active branch from this business");
    if (!service) throw new Error("Choose an active service from this business");
    const availability = await findAvailableStaff(tx, input);
    const customer = await tx.customer.upsert({
      where: { vendorId_phone: { vendorId: input.vendorId, phone: customerPhone } },
      update: {
        name: input.customer.name,
        email: input.customer.email,
        smsOptIn: input.customer.smsOptIn ? true : undefined,
        whatsappOptIn: input.customer.whatsappOptIn ?? false,
        telegramId: input.customer.telegramId
      },
      create: {
        vendorId: input.vendorId,
        name: input.customer.name,
        phone: customerPhone,
        email: input.customer.email,
        smsOptIn: input.customer.smsOptIn ?? false,
        whatsappOptIn: input.customer.whatsappOptIn ?? false,
        telegramId: input.customer.telegramId
      }
    });

    const created = await tx.appointment.create({
      data: {
        vendorId: input.vendorId,
        branchId: input.branchId,
        serviceId: input.serviceId,
        staffId: availability.staff.id,
        customerId: customer.id,
        startAt: input.startAt,
        endAt: availability.endAt,
        status: AppointmentStatus.CONFIRMED,
        source: input.source,
        notes: input.notes,
        history: {
          create: {
            action: "created",
            newValues: {
              source: input.source,
              staffId: availability.staff.id,
              startAt: input.startAt.toISOString()
            }
          }
        }
      },
      include: { customer: true, service: true, staff: true, branch: true }
    });

    await tx.customer.update({
      where: { id: customer.id },
      data: { lastAppointmentAt: input.startAt }
    });

    return created;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  await enqueueAppointmentNotifications(appointment.id, "confirmation");
  await scheduleAppointmentReminders(appointment.id);
  await recordActivity(appointment.id, "new_booking");
  publishLiveEvent(input.vendorId, ["appointments", "customers", "notifications", "calendar"]);
  return appointment;
}

export async function rescheduleAppointment(vendorId: string, appointmentId: string, startAt: Date, staffId?: string, actor: "staff" | "customer" = "staff", actorUserId?: string) {
  if (startAt.getTime() <= Date.now()) throw new Error("New appointment time must be in the future");
  const appointment = await prisma.$transaction(async (tx) => {
    const existing = await tx.appointment.findFirstOrThrow({ where: { id: appointmentId, vendorId } });
    if (([AppointmentStatus.CANCELLED, AppointmentStatus.COMPLETED, AppointmentStatus.NO_SHOW] as AppointmentStatus[]).includes(existing.status)) {
      throw new Error(`A ${existing.status.toLowerCase().replace("_", "-")} appointment cannot be rescheduled`);
    }
    const [branch, service] = await Promise.all([
      tx.branch.findFirst({ where: { id: existing.branchId, vendorId, active: true }, select: { id: true } }),
      tx.service.findFirst({ where: { id: existing.serviceId, vendorId, active: true }, select: { id: true } })
    ]);
    if (!branch) throw new Error("The appointment branch is no longer active");
    if (!service) throw new Error("The appointment service is no longer active");
    const availability = await findAvailableStaff(tx, {
      vendorId,
      branchId: existing.branchId,
      serviceId: existing.serviceId,
      staffId: staffId ?? existing.staffId,
      startAt,
      excludeAppointmentId: existing.id
    });

    return tx.appointment.update({
      where: { id: appointmentId },
      data: {
        staffId: availability.staff.id,
        startAt,
        endAt: availability.endAt,
        status: AppointmentStatus.RESCHEDULED,
        history: {
          create: {
            action: actor === "customer" ? "customer_rescheduled" : "rescheduled",
            actorUserId,
            oldValues: { startAt: existing.startAt, staffId: existing.staffId },
            newValues: { startAt, staffId: availability.staff.id, actor }
          }
        }
      },
      include: { customer: true, service: true, staff: true, branch: true }
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  await cancelAppointmentReminderJobs(appointment.id);
  await enqueueAppointmentNotifications(appointment.id, "reschedule");
  await scheduleAppointmentReminders(appointment.id);
  await recordActivity(appointment.id, "appointment_rescheduled");
  publishLiveEvent(vendorId, ["appointments", "notifications", "calendar"]);
  return appointment;
}

export async function cancelAppointment(vendorId: string, appointmentId: string, reason?: string, actor: "staff" | "customer" = "staff", actorUserId?: string) {
  const existing = await prisma.appointment.findFirstOrThrow({ where: { id: appointmentId, vendorId } });
  assertAppointmentTransition(existing.status, AppointmentStatus.CANCELLED, existing.startAt);
  const appointment = await prisma.appointment.update({
    where: { id: existing.id },
    data: {
      status: AppointmentStatus.CANCELLED,
      history: { create: { action: actor === "customer" ? "customer_cancelled" : "cancelled", actorUserId, newValues: { reason, actor } } }
    }
  });
  await cancelAppointmentReminderJobs(appointment.id);
  await enqueueAppointmentNotifications(appointment.id, "cancellation");
  await recordActivity(appointment.id, "appointment_cancelled");
  publishLiveEvent(vendorId, ["appointments", "notifications", "calendar"]);
  return appointment;
}

export async function completeAppointment(vendorId: string, appointmentId: string) {
  const existing = await prisma.appointment.findFirstOrThrow({ where: { id: appointmentId, vendorId } });
  assertAppointmentTransition(existing.status, AppointmentStatus.COMPLETED, existing.startAt);
  const appointment = await prisma.appointment.update({
    where: { id: existing.id },
    data: {
      status: AppointmentStatus.COMPLETED,
      history: { create: { action: "completed" } }
    },
    include: { customer: true, service: true, staff: true, branch: true, history: { orderBy: { createdAt: "desc" } } }
  });
  await cancelAppointmentReminderJobs(appointment.id);
  await scheduleAppointmentFollowUp(appointment.id);
  await recordActivity(appointment.id, "appointment_completed");
  publishLiveEvent(vendorId, ["appointments", "customers", "notifications"]);
  return appointment;
}

export async function markNoShowAppointment(vendorId: string, appointmentId: string) {
  const existing = await prisma.appointment.findFirstOrThrow({ where: { id: appointmentId, vendorId } });
  assertAppointmentTransition(existing.status, AppointmentStatus.NO_SHOW, existing.startAt);
  const appointment = await prisma.$transaction(async (tx) => {
    const updated = await tx.appointment.update({
      where: { id: existing.id },
      data: {
        status: AppointmentStatus.NO_SHOW,
        history: { create: { action: "no_show" } }
      },
      include: { customer: true, service: true, staff: true, branch: true, history: { orderBy: { createdAt: "desc" } } }
    });
    await tx.customer.update({
      where: { id: existing.customerId },
      data: { noShowCount: { increment: 1 } }
    });
    return updated;
  });
  await cancelAppointmentReminderJobs(appointment.id);
  await recordActivity(appointment.id, "appointment_no_show");
  publishLiveEvent(vendorId, ["appointments", "customers", "notifications"]);
  return appointment;
}
