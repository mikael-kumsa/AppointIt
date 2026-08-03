import { AppointmentStatus, LogStatus, NotificationChannel } from "@prisma/client";
import { prisma } from "../../db.js";
import { decryptSecret } from "../../utils/crypto.js";
import { sendPlatformEmail } from "./email.service.js";
import { sendSms } from "./sms.service.js";
import { formatInTimezone } from "../../utils/timezone.js";
import { env } from "../../config/env.js";
import { signAppointmentManagementToken } from "../appointments/appointment-management.service.js";
import { deliverAppointmentNotification } from "./notification-delivery.service.js";

export async function logNotification(
  vendorId: string,
  appointmentId: string,
  channel: NotificationChannel,
  type: string,
  status: "SENT" | "FAILED",
  errorMessage?: string
) {
  return prisma.notificationLog.create({
    data: { vendorId, appointmentId, channel, type, status, errorMessage }
  });
}

function appointmentSubject(type: string) {
  if (type.includes("reminder")) return "Appointment reminder";
  if (type === "cancellation") return "Appointment cancelled";
  if (type === "reschedule") return "Appointment rescheduled";
  if (type === "follow_up") return "Thank you for your visit";
  return "Appointment confirmed";
}

function appointmentBody(appointment: Awaited<ReturnType<typeof loadAppointmentForNotification>>, type: string) {
  const manageUrl = new URL("/manage-booking", env.APP_ORIGIN);
  manageUrl.searchParams.set("token", signAppointmentManagementToken(appointment));
  return [
    `Hello ${appointment.customer.name},`,
    "",
    `${appointmentSubject(type)}: ${appointment.service.name}`,
    `When: ${formatInTimezone(appointment.startAt, appointment.vendor.timezone)}`,
    `Provider: ${appointment.staff.name}`,
    "",
    `Business: ${appointment.vendor.name}`,
    "",
    `Manage appointment: ${manageUrl.toString()}`
  ].join("\n");
}

async function loadAppointmentForNotification(appointmentId: string) {
  return prisma.appointment.findUniqueOrThrow({
    where: { id: appointmentId },
    include: {
      customer: true,
      vendor: { include: { messageSettings: true } },
      service: true,
      staff: true,
      branch: true
    }
  });
}

async function sendEmailNotification(appointment: Awaited<ReturnType<typeof loadAppointmentForNotification>>, type: string) {
  if (!appointment.customer.email) return null;
  try {
    const result = await sendPlatformEmail({
      to: appointment.customer.email,
      subject: appointmentSubject(type),
      text: appointmentBody(appointment, type)
    });
    return prisma.notificationLog.create({
      data: {
        vendorId: appointment.vendorId,
        appointmentId: appointment.id,
        customerId: appointment.customerId,
        channel: NotificationChannel.EMAIL,
        type,
        status: LogStatus.SENT,
        providerMessageId: result.messageId
      }
    });
  } catch (error) {
    return logNotification(appointment.vendorId, appointment.id, NotificationChannel.EMAIL, type, LogStatus.FAILED, error instanceof Error ? error.message : "Email failed");
  }
}

async function sendSmsNotification(appointment: Awaited<ReturnType<typeof loadAppointmentForNotification>>, type: string) {
  const settings = appointment.vendor.messageSettings;
  const enabled = settings?.smsEnabled ?? false;
  if (!enabled) return null;
  if (!appointment.customer.phone) return null;

  try {
    const result = await sendSms({
      to: appointment.customer.phone,
      message: appointmentBody(appointment, type),
      from: settings?.smsFrom,
      vendorId: appointment.vendorId,
      appointmentId: appointment.id,
      provider: settings?.smsProvider,
      gatewayUrl: settings?.smsGatewayUrl,
      apiKey: settings?.encryptedSmsGatewayApiKey ? decryptSecret(settings.encryptedSmsGatewayApiKey) : undefined,
      identifierId: settings?.smsIdentifierId
    });
    return prisma.notificationLog.create({
      data: {
        vendorId: appointment.vendorId,
        appointmentId: appointment.id,
        customerId: appointment.customerId,
        channel: NotificationChannel.SMS,
        type,
        status: LogStatus.SENT,
        providerMessageId: result.providerMessageId
      }
    });
  } catch (error) {
    return prisma.notificationLog.create({
      data: {
        vendorId: appointment.vendorId,
        appointmentId: appointment.id,
        customerId: appointment.customerId,
        channel: NotificationChannel.SMS,
        type,
        status: LogStatus.FAILED,
        errorMessage: error instanceof Error ? error.message : "SMS send failed"
      }
    });
  }
}

export async function sendAppointmentNotification(appointmentId: string, type: string, notificationKey?: string, channels?: Array<"sms" | "email">) {
  return deliverAppointmentNotification(appointmentId, type, notificationKey, channels);
}
