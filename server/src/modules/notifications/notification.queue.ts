import { Queue } from "bullmq";
import { prisma } from "../../db.js";
import { env } from "../../config/env.js";
import { reminderSettings, reminderType } from "./reminder-settings.js";
import crypto from "node:crypto";
import { ReminderScheduleStatus } from "@prisma/client";

const redisUrl = new URL(env.REDIS_URL);
const redisConnection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  password: redisUrl.password || undefined,
  maxRetriesPerRequest: null
};

let notificationQueue: Queue | null = null;

function getNotificationQueue() {
  if (!notificationQueue) {
    notificationQueue = new Queue("notifications", { connection: redisConnection });
    notificationQueue.on("error", (error) => {
      console.warn("[notifications] queue unavailable:", error.message);
    });
  }
  return notificationQueue;
}

function reminderJobIds(appointmentId: string, offsetsMinutes: number[]) {
  return offsetsMinutes.map((offset) => `appointment:${appointmentId}:reminder-${offset}m`);
}

function followUpJobId(appointmentId: string) {
  return `appointment:${appointmentId}:follow_up`;
}

async function removeJobIfExists(queue: Queue, jobId: string) {
  const job = await queue.getJob(jobId);
  if (job) await job.remove();
}

export async function enqueueAppointmentNotification(appointmentId: string, type: string, options: { delay?: number; jobId?: string; notificationKey?: string; channels?: Array<"sms" | "email"> } = {}) {
  try {
    const queue = getNotificationQueue();
    const jobId = options.jobId ?? `appointment:${appointmentId}:${type}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    await queue.add(
      "appointment-notification",
      { appointmentId, type, notificationKey: options.notificationKey ?? jobId, ...(options.channels ? { channels: options.channels } : {}) },
      {
        delay: options.delay,
        jobId,
        attempts: 4,
        backoff: { type: "exponential", delay: 10_000 },
        removeOnComplete: { age: 86_400, count: 5_000 },
        removeOnFail: false
      }
    );
    return { queued: true as const, jobId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[notifications] skipped queue job:", message);
    return { queued: false as const, error: message };
  }
}

export async function scheduleAppointmentReminders(appointmentId: string) {
  try {
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        id: true,
        vendorId: true,
        startAt: true,
        customer: { select: { phone: true, smsOptIn: true } },
        vendor: { select: { settings: true, messageSettings: true } }
      }
    });
    if (!appointment) return;
    const queue = getNotificationQueue();
    const settings = reminderSettings(appointment.vendor.settings);
    if (!settings.automaticEnabled) return;
    const reminders = settings.offsetsMinutes.map((offsetMinutes) => ({ type: reminderType(offsetMinutes), offsetMs: offsetMinutes * 60_000, jobId: reminderJobIds(appointmentId, [offsetMinutes])[0] }));

    await Promise.all(reminders.map(async (reminder) => {
      await removeJobIfExists(queue, reminder.jobId);
      const delay = appointment.startAt.getTime() - Date.now() - reminder.offsetMs;
      const scheduledFor = new Date(appointment.startAt.getTime() - reminder.offsetMs);
      const smsSettings = appointment.vendor.messageSettings;
      const skipReason = !smsSettings?.smsEnabled
        ? "SMS reminders are disabled"
        : !smsSettings.encryptedSmsGatewayApiKey
          ? "AfroMessage API token is missing"
          : !appointment.customer.phone
            ? "Customer phone number is missing"
            : !appointment.customer.smsOptIn
              ? "Customer has not consented to SMS"
              : delay <= 0
                ? "Reminder time has already passed"
                : null;

      await prisma.reminderSchedule.upsert({
        where: { jobId: reminder.jobId },
        update: {
          type: reminder.type,
          offsetMinutes: reminder.offsetMs / 60_000,
          scheduledFor,
          status: skipReason ? ReminderScheduleStatus.SKIPPED : ReminderScheduleStatus.SCHEDULED,
          skipReason,
          lastError: null,
          notificationLogId: null
        },
        create: {
          vendorId: appointment.vendorId,
          appointmentId,
          type: reminder.type,
          offsetMinutes: reminder.offsetMs / 60_000,
          scheduledFor,
          status: skipReason ? ReminderScheduleStatus.SKIPPED : ReminderScheduleStatus.SCHEDULED,
          skipReason,
          jobId: reminder.jobId
        }
      });

      if (delay > 0 && !skipReason) {
        await queue.add("appointment-reminder", { appointmentId, type: reminder.type, notificationKey: reminder.jobId }, { delay, jobId: reminder.jobId, attempts: 4, backoff: { type: "exponential", delay: 10_000 }, removeOnComplete: { age: 86_400, count: 5_000 }, removeOnFail: false });
      }
    }));
  } catch (error) {
    console.warn("[notifications] skipped reminder scheduling:", error instanceof Error ? error.message : error);
  }
}

export async function cancelAppointmentReminderJobs(appointmentId: string, offsetsMinutes?: number[]) {
  try {
    const queue = getNotificationQueue();
    let offsets = offsetsMinutes;
    if (!offsets) {
      const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId }, select: { vendor: { select: { settings: true } } } });
      offsets = appointment ? reminderSettings(appointment.vendor.settings).offsetsMinutes : [];
    }
    const legacyIds = [`appointment:${appointmentId}:reminder_24h`, `appointment:${appointmentId}:reminder_2h`];
    const jobIds = [...legacyIds, ...reminderJobIds(appointmentId, offsets), followUpJobId(appointmentId)];
    await Promise.all(jobIds.map((jobId) => removeJobIfExists(queue, jobId)));
    await prisma.reminderSchedule.updateMany({
      where: { appointmentId, jobId: { in: jobIds }, status: { in: [ReminderScheduleStatus.SCHEDULED, ReminderScheduleStatus.QUEUED, ReminderScheduleStatus.SKIPPED] } },
      data: { status: ReminderScheduleStatus.CANCELLED, skipReason: "Appointment changed or reminders were rescheduled" }
    });
  } catch (error) {
    console.warn("[notifications] skipped reminder cleanup:", error instanceof Error ? error.message : error);
  }
}

export async function scheduleAppointmentFollowUp(appointmentId: string) {
  await enqueueAppointmentNotification(appointmentId, "follow_up", {
    delay: 60 * 60 * 1000,
    jobId: followUpJobId(appointmentId)
  });
}

export async function enqueueAppointmentNotifications(appointmentId: string, type: string) {
  await enqueueAppointmentNotification(appointmentId, type);
}
