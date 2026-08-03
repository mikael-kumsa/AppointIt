import { PlanVersionStatus, Prisma, UserRole } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { entitlementRecord, entitlementRows, planVersionInputSchema } from "./plans.service.js";
import { publishLiveEvent } from "../live/live-events.js";

export const plansRouter = Router();

const planMetadataSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().min(10).max(300),
  displayOrder: z.number().int().min(0).max(1000),
  isPublic: z.boolean()
});

const createPlanSchema = planMetadataSchema.extend({
  code: z.string().trim().regex(/^[A-Z][A-Z0-9_]{2,29}$/),
  version: planVersionInputSchema
});

const publishPlanSchema = planVersionInputSchema.extend({ metadata: planMetadataSchema.optional() });

const planInclude = {
  versions: {
    orderBy: { version: "desc" as const },
    include: { entitlements: true, _count: { select: { subscriptions: true } } }
  }
};

function serializePlan(plan: Prisma.SubscriptionPlanGetPayload<{ include: typeof planInclude }>) {
  const published = plan.versions.find((version) => version.status === PlanVersionStatus.PUBLISHED) ?? plan.versions[0];
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    description: plan.description,
    displayOrder: plan.displayOrder,
    active: plan.active,
    isPublic: plan.isPublic,
    currentVersion: published ? {
      id: published.id,
      version: published.version,
      currency: published.currency,
      monthlyPriceCents: published.monthlyPriceCents,
      annualPriceCents: published.annualPriceCents,
      trialDays: published.trialDays,
      publishedAt: published.publishedAt,
      subscriberCount: plan.versions.reduce((total, version) => total + version._count.subscriptions, 0),
      entitlements: entitlementRecord(published.entitlements)
    } : null
  };
}

plansRouter.get("/public", async (_req, res) => {
  const plans = await prisma.subscriptionPlan.findMany({
    where: { active: true, isPublic: true, versions: { some: { status: PlanVersionStatus.PUBLISHED } } },
    include: planInclude,
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }]
  });
  res.set("Cache-Control", "no-store, max-age=0");
  return res.json(plans.map(serializePlan));
});

plansRouter.use(requireAuth, requireRole(UserRole.SUPER_ADMIN));

plansRouter.get("/", async (_req, res) => {
  const plans = await prisma.subscriptionPlan.findMany({
    include: planInclude,
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }]
  });
  return res.json(plans.map(serializePlan));
});

plansRouter.post("/", validateBody(createPlanSchema), async (req, res) => {
  const parsedVersion = planVersionInputSchema.parse(req.body.version);
  try {
    const plan = await prisma.$transaction(async (tx) => tx.subscriptionPlan.create({
      data: {
        code: req.body.code,
        name: req.body.name,
        description: req.body.description,
        displayOrder: req.body.displayOrder,
        isPublic: req.body.isPublic,
        versions: {
          create: {
            version: 1,
            currency: parsedVersion.currency,
            monthlyPriceCents: parsedVersion.monthlyPriceCents,
            annualPriceCents: parsedVersion.annualPriceCents,
            trialDays: parsedVersion.trialDays,
            entitlements: { create: entitlementRows(parsedVersion.entitlements) }
          }
        }
      },
      include: planInclude
    }));
    await prisma.auditLog.create({
      data: { actorUserId: req.user?.id, action: "subscription_plan_created", entityType: "SubscriptionPlan", entityId: plan.id, metadata: { code: plan.code } }
    });
    publishLiveEvent("platform", ["plans", "logs"]);
    return res.status(201).json(serializePlan(plan));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return res.status(409).json({ error: "Plan code already exists" });
    }
    throw error;
  }
});

plansRouter.patch("/:id", validateBody(planMetadataSchema), async (req, res) => {
  const existing = await prisma.subscriptionPlan.findUnique({ where: { id: String(req.params.id) } });
  if (!existing) return res.status(404).json({ error: "Plan not found" });
  const plan = await prisma.subscriptionPlan.update({
    where: { id: existing.id },
    data: req.body,
    include: planInclude
  });
  await prisma.auditLog.create({
    data: { actorUserId: req.user?.id, action: "subscription_plan_metadata_changed", entityType: "SubscriptionPlan", entityId: plan.id, metadata: req.body }
  });
  publishLiveEvent("platform", ["plans", "logs"]);
  return res.json(serializePlan(plan));
});

plansRouter.post("/:id/publish", validateBody(publishPlanSchema), async (req, res) => {
  const planId = String(req.params.id);
  const existing = await prisma.subscriptionPlan.findUnique({
    where: { id: planId },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } }
  });
  if (!existing) return res.status(404).json({ error: "Plan not found" });
  if (!existing.active) return res.status(409).json({ error: "Reactivate the plan before publishing a new version" });
  const input = publishPlanSchema.parse(req.body);
  const nextVersion = (existing.versions[0]?.version ?? 0) + 1;
  const plan = await prisma.$transaction(async (tx) => {
    if (input.metadata) await tx.subscriptionPlan.update({ where: { id: planId }, data: input.metadata });
    await tx.planVersion.updateMany({
      where: { planId, status: PlanVersionStatus.PUBLISHED },
      data: { status: PlanVersionStatus.ARCHIVED }
    });
    await tx.planVersion.create({
      data: {
        planId,
        version: nextVersion,
        currency: input.currency,
        monthlyPriceCents: input.monthlyPriceCents,
        annualPriceCents: input.annualPriceCents,
        trialDays: input.trialDays,
        entitlements: { create: entitlementRows(input.entitlements) }
      }
    });
    await tx.auditLog.create({
      data: { actorUserId: req.user?.id, action: "subscription_plan_version_published", entityType: "SubscriptionPlan", entityId: planId, metadata: { version: nextVersion, planMetadataChanged: Boolean(input.metadata) } }
    });
    return tx.subscriptionPlan.findUniqueOrThrow({ where: { id: planId }, include: planInclude });
  });
  publishLiveEvent("platform", ["plans", "logs"]);
  return res.json(serializePlan(plan));
});

plansRouter.post("/:id/archive", async (req, res) => {
  const existing = await prisma.subscriptionPlan.findUnique({ where: { id: String(req.params.id) } });
  if (!existing) return res.status(404).json({ error: "Plan not found" });
  const plan = await prisma.subscriptionPlan.update({
    where: { id: existing.id },
    data: { active: false, isPublic: false },
    include: planInclude
  });
  await prisma.auditLog.create({
    data: { actorUserId: req.user?.id, action: "subscription_plan_archived", entityType: "SubscriptionPlan", entityId: plan.id }
  });
  publishLiveEvent("platform", ["plans", "logs"]);
  return res.json(serializePlan(plan));
});

plansRouter.post("/:id/reactivate", async (req, res) => {
  const existing = await prisma.subscriptionPlan.findUnique({ where: { id: String(req.params.id) } });
  if (!existing) return res.status(404).json({ error: "Plan not found" });
  const plan = await prisma.subscriptionPlan.update({
    where: { id: existing.id },
    data: { active: true },
    include: planInclude
  });
  await prisma.auditLog.create({
    data: { actorUserId: req.user?.id, action: "subscription_plan_reactivated", entityType: "SubscriptionPlan", entityId: plan.id }
  });
  publishLiveEvent("platform", ["plans", "logs"]);
  return res.json(serializePlan(plan));
});
