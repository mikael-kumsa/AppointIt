import { AppointmentStatus, LogStatus, NotificationChannel, ReminderScheduleStatus } from "@prisma/client";
import { prisma } from "../../db.js";
import { decryptSecret } from "../../utils/crypto.js";
import { formatInTimezone } from "../../utils/timezone.js";
import { env } from "../../config/env.js";
import { signAppointmentManagementToken } from "../appointments/appointment-management.service.js";
import { publishLiveEvent } from "../live/live-events.js";
import { sendPlatformEmail } from "./email.service.js";
import { sendSms } from "./sms.service.js";

export function normalizedTemplateType(type: string) {
  if (type === "manual_reminder" || type.startsWith("reminder")) return "reminder";
  if (type === "appointment_confirmation") return "confirmation";
  if (type === "appointment_cancelled" || type === "cancelled") return "cancellation";
  if (type === "appointment_rescheduled" || type === "rescheduled") return "reschedule";
  return type;
}

function appointmentSubject(type: string) {
  if (type.includes("reminder")) return "Appointment reminder";
  if (type === "cancellation") return "Appointment cancelled";
  if (type === "reschedule") return "Appointment rescheduled";
  if (type === "follow_up") return "Thank you for your visit";
  return "Appointment confirmed";
}

async function loadAppointment(appointmentId: string) {
  return prisma.appointment.findUniqueOrThrow({
    where: { id: appointmentId },
    include: {
      customer: true,
      vendor: { include: { messageSettings: true, messageTemplates: { where: { active: true } } } },
      service: true,
      staff: true,
      branch: true
    }
  });
}

type AppointmentForDelivery = Awaited<ReturnType<typeof loadAppointment>>;

function variables(appointment: AppointmentForDelivery) {
  const manageUrl = new URL("/manage-booking", env.APP_ORIGIN);
  manageUrl.searchParams.set("token", signAppointmentManagementToken(appointment));
  const dateTime = formatInTimezone(appointment.startAt, appointment.vendor.timezone);
  return {
    customer: appointment.customer.name,
    customer_name: appointment.customer.name,
    service: appointment.service.name,
    date_time: dateTime,
    datetime: dateTime,
    date: dateTime,
    time: dateTime,
    provider: appointment.staff.name,
    provider_name: appointment.staff.name,
    staff: appointment.staff.name,
    staff_name: appointment.staff.name,
    business: appointment.vendor.name,
    business_name: appointment.vendor.name,
    branch: appointment.branch.name,
    location: appointment.branch.name,
    address: appointment.branch.address,
    manage_url: manageUrl.toString()
  };
}

export function renderMessageTemplate(template: string, values: Record<string, string>) {
  return template.replace(/{{\s*([a-z_]+)\s*}}/gi, (match, key: string) => values[key.toLowerCase()] ?? match);
}

function defaultBody(appointment: AppointmentForDelivery, type: string) {
  const value = variables(appointment);
  return [
    `Hello ${value.customer},`, "", `${appointmentSubject(type)}: ${value.service}`,
    `When: ${value.date_time}`, `Provider: ${value.provider}`,
    `Location: ${value.branch}, ${value.address}`, "", `Business: ${value.business}`, "",
    `Manage appointment: ${value.manage_url}`
  ].join("\n");
}

function content(appointment: AppointmentForDelivery, channel: NotificationChannel, type: string) {
  const template = appointment.vendor.messageTemplates.find((item) => item.channel === channel && item.type === normalizedTemplateType(type));
  const value = variables(appointment);
  return {
    subject: template?.subject ? renderMessageTemplate(template.subject, value) : appointmentSubject(type),
    body: template?.body ? renderMessageTemplate(template.body, value) : defaultBody(appointment, type)
  };
}

async function prepareAttempt(appointment: AppointmentForDelivery, channel: NotificationChannel, type: string, notificationKey: string) {
  const idempotencyKey = `${notificationKey}:${channel}`;
  const existing = await prisma.notificationLog.findUnique({ where: { idempotencyKey } });
  const completedStatuses: LogStatus[] = [LogStatus.SENT, LogStatus.DELIVERED, LogStatus.READ];
  if (existing && completedStatuses.includes(existing.status)) return { log: existing, skip: true };
  const log = existing
    ? await prisma.notificationLog.update({ where: { id: existing.id }, data: { status: LogStatus.PENDING, errorMessage: null, attemptCount: { increment: 1 }, lastAttemptAt: new Date() } })
    : await prisma.notificationLog.create({ data: { vendorId: appointment.vendorId, appointmentId: appointment.id, customerId: appointment.customerId, channel, type, status: LogStatus.PENDING, idempotencyKey, attemptCount: 1, lastAttemptAt: new Date() } });
  await prisma.reminderSchedule.updateMany({
    where: { jobId: notificationKey, channel },
    data: { notificationLogId: log.id, status: ReminderScheduleStatus.QUEUED, lastError: null }
  });
  publishLiveEvent(appointment.vendorId, ["notifications"]);
  return { log, skip: false };
}

async function finishAttempt(logId: string, vendorId: string, status: LogStatus, providerMessageId?: string, errorMessage?: string) {
  const log = await prisma.notificationLog.update({ where: { id: logId }, data: { status, providerMessageId, errorMessage } });
  await prisma.reminderSchedule.updateMany({
    where: { notificationLogId: logId },
    data: {
      status: status === LogStatus.FAILED ? ReminderScheduleStatus.FAILED : ReminderScheduleStatus.SENT,
      lastError: errorMessage ?? null
    }
  });
  publishLiveEvent(vendorId, ["notifications"]);
  return log;
}

async function email(appointment: AppointmentForDelivery, type: string, notificationKey: string) {
  if (!appointment.customer.email) return null;
  const attempt = await prepareAttempt(appointment, NotificationChannel.EMAIL, type, notificationKey);
  if (attempt.skip) return attempt.log;
  try {
    const message = content(appointment, NotificationChannel.EMAIL, type);
    const result = await sendPlatformEmail({ to: appointment.customer.email, subject: message.subject, text: message.body });
    return await finishAttempt(attempt.log.id, appointment.vendorId, LogStatus.SENT, result.messageId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Email failed";
    await finishAttempt(attempt.log.id, appointment.vendorId, LogStatus.FAILED, undefined, message);
    throw new Error(`Email: ${message}`);
  }
}

async function sms(appointment: AppointmentForDelivery, type: string, notificationKey: string) {
  const settings = appointment.vendor.messageSettings;
  if (!settings?.smsEnabled || !appointment.customer.phone || !appointment.customer.smsOptIn) return null;
  const attempt = await prepareAttempt(appointment, NotificationChannel.SMS, type, notificationKey);
  if (attempt.skip) return attempt.log;
  try {
    const message = content(appointment, NotificationChannel.SMS, type);
    const result = await sendSms({
      to: appointment.customer.phone, message: message.body, from: settings.smsFrom,
      vendorId: appointment.vendorId, appointmentId: appointment.id, provider: settings.smsProvider,
      gatewayUrl: settings.smsGatewayUrl,
      apiKey: settings.encryptedSmsGatewayApiKey ? decryptSecret(settings.encryptedSmsGatewayApiKey) : undefined,
      identifierId: settings.smsIdentifierId
    });
    return await finishAttempt(attempt.log.id, appointment.vendorId, LogStatus.SENT, result.providerMessageId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "SMS send failed";
    await finishAttempt(attempt.log.id, appointment.vendorId, LogStatus.FAILED, undefined, message);
    throw new Error(`SMS: ${message}`);
  }
}

export async function deliverAppointmentNotification(appointmentId: string, type: string, notificationKey = `${appointmentId}:${type}`, channels: Array<"sms" | "email"> = ["email", "sms"]) {
  const appointment = await loadAppointment(appointmentId);
  const active: AppointmentStatus[] = [AppointmentStatus.CONFIRMED, AppointmentStatus.RESCHEDULED, AppointmentStatus.PENDING];
  if (type.includes("reminder") && !active.includes(appointment.status)) return;
  if (type === "follow_up" && appointment.status !== AppointmentStatus.COMPLETED) return;
  const deliveries = [];
  if (channels.includes("email")) deliveries.push(email(appointment, type, notificationKey));
  if (channels.includes("sms")) deliveries.push(sms(appointment, type, notificationKey));
  const results = await Promise.allSettled(deliveries);
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failures.length) throw new Error(failures.map((failure) => failure.reason instanceof Error ? failure.reason.message : String(failure.reason)).join("; "));
}
