import { DomainStatus, Prisma, PrismaClient, SubscriptionStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../db.js";

export const planEntitlementsSchema = z.object({
  maxBranches: z.number().int().refine((value) => value === -1 || value > 0, "Use -1 for unlimited or a positive branch limit"),
  maxStaff: z.number().int().refine((value) => value === -1 || value > 0, "Use -1 for unlimited or a positive staff limit"),
  customDomain: z.boolean(),
  calendarSync: z.boolean(),
  smsAutomation: z.boolean(),
  advancedReports: z.boolean(),
  auditRetentionDays: z.number().int().min(1).max(3650),
  prioritySupport: z.boolean(),
  customIntegrations: z.boolean()
});

export const planVersionInputSchema = z.object({
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()),
  monthlyPriceCents: z.number().int().positive().nullable(),
  annualPriceCents: z.number().int().positive().nullable(),
  trialDays: z.number().int().min(0).max(365).default(0),
  entitlements: planEntitlementsSchema
});

export type PlanEntitlements = z.infer<typeof planEntitlementsSchema>;

export const activeCustomDomainSubscriptionWhere = {
  status: SubscriptionStatus.ACTIVE,
  planVersion: {
    entitlements: {
      some: { key: "customDomain", value: { equals: true } }
    }
  }
} satisfies Prisma.VendorSubscriptionWhereInput;

export function entitlementRows(entitlements: PlanEntitlements) {
  return Object.entries(entitlements).map(([key, value]) => ({
    key,
    value: value as Prisma.InputJsonValue
  }));
}

export function entitlementRecord(rows: Array<{ key: string; value: Prisma.JsonValue }>) {
  return planEntitlementsSchema.parse(Object.fromEntries(rows.map((row) => [row.key, row.value])));
}

export async function getVendorPlanContext(vendorId: string) {
  const subscription = await prisma.vendorSubscription.findUnique({
    where: { vendorId },
    include: {
      planVersion: {
        include: { plan: true, entitlements: true }
      }
    }
  });
  if (!subscription) return null;
  return {
    subscription,
    plan: subscription.planVersion.plan,
    version: subscription.planVersion,
    entitlements: entitlementRecord(subscription.planVersion.entitlements)
  };
}

export async function requireActiveVendorEntitlements(vendorId: string) {
  const context = await getVendorPlanContext(vendorId);
  if (!context || context.subscription.status !== SubscriptionStatus.ACTIVE) {
    throw new Error("An active paid subscription is required");
  }
  return context;
}

export async function enforceVendorLimit(vendorId: string, key: "maxBranches" | "maxStaff", currentCount: number, label: string) {
  const context = await requireActiveVendorEntitlements(vendorId);
  const limit = context.entitlements[key];
  if (limit !== -1 && currentCount >= limit) {
    const displayLabel = limit === 1 && label === "branches" ? "branch" : label;
    throw new Error(`${context.plan.name} allows up to ${limit} ${displayLabel}. Upgrade the subscription to add more.`);
  }
  return context;
}

export async function applyPlanCapabilityState(db: PrismaClient | Prisma.TransactionClient, vendorId: string, planVersionId: string) {
  const version = await db.planVersion.findUniqueOrThrow({ where: { id: planVersionId }, select: { entitlements: true } });
  const entitlements = entitlementRecord(version.entitlements);
  await Promise.all([
    entitlements.customDomain ? Promise.resolve() : db.vendorDomain.updateMany({ where: { vendorId }, data: { status: DomainStatus.DISABLED } }),
    entitlements.calendarSync ? Promise.resolve() : db.calendarConnection.updateMany({ where: { vendorId }, data: { syncEnabled: false } }),
    entitlements.smsAutomation ? Promise.resolve() : db.messageSetting.updateMany({ where: { vendorId }, data: { smsEnabled: false } })
  ]);
  return entitlements;
}
