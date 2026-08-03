import { Queue, Worker } from "bullmq";
import { sendAppointmentNotification } from "../../server/src/modules/notifications/notification.service.js";
import { env } from "../../server/src/config/env.js";
import { prisma } from "../../server/src/db.js";
import { SubscriptionStatus } from "@prisma/client";

const redisUrl = new URL(env.REDIS_URL);
const connection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  password: redisUrl.password || undefined,
  maxRetriesPerRequest: null
};

const deadLetterQueue = new Queue("notifications-dead-letter", { connection });
const notificationWorker = new Worker(
  "notifications",
  async (job) => {
    console.log(`[worker] ${job.name}`, job.data);
    if (job.name === "appointment-notification" || job.name === "appointment-reminder") {
      await sendAppointmentNotification(job.data.appointmentId, job.data.type, job.data.notificationKey, job.data.channels);
    }
  },
  { connection }
);

notificationWorker.on("failed", (job, error) => {
  if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
  void deadLetterQueue.add("notification-failed", { sourceJobId: job.id, ...job.data, error: error.message, failedAt: new Date().toISOString() }, { jobId: `dead-${job.id}`, removeOnComplete: false });
});

console.log("AppointIt worker listening for notification jobs");

async function expireSubscriptions() {
  const result = await prisma.vendorSubscription.updateMany({ where: { status: SubscriptionStatus.ACTIVE, currentPeriodEnd: { lt: new Date() } }, data: { status: SubscriptionStatus.EXPIRED } });
  if (result.count) console.log(`[worker] expired ${result.count} subscription(s)`);
}

async function enforceAuditRetention() {
  const subscriptions = await prisma.vendorSubscription.findMany({ where: { status: SubscriptionStatus.ACTIVE }, select: { vendorId: true, planVersion: { select: { entitlements: { where: { key: "auditRetentionDays" }, select: { value: true } } } } } });
  for (const subscription of subscriptions) {
    const raw = subscription.planVersion.entitlements[0]?.value;
    const days = typeof raw === "number" && Number.isFinite(raw) ? raw : 90;
    await prisma.auditLog.deleteMany({ where: { vendorId: subscription.vendorId, createdAt: { lt: new Date(Date.now() - days * 86_400_000) } } });
  }
}

void expireSubscriptions();
void enforceAuditRetention().catch((error) => console.error("[worker] audit retention failed", error));
setInterval(() => void expireSubscriptions().catch((error) => console.error("[worker] subscription expiry failed", error)), 15 * 60 * 1000);
setInterval(() => void enforceAuditRetention().catch((error) => console.error("[worker] audit retention failed", error)), 24 * 60 * 60 * 1000);
