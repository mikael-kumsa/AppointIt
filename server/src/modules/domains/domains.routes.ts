import { DomainStatus, Prisma, UserRole } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env.js";
import { prisma } from "../../db.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { normalizeHostname } from "../../utils/hostname.js";
import { getVendorPlanContext, requireActiveVendorEntitlements } from "../plans/plans.service.js";
import { customDomainProviderReady, provisionCustomDomain, refreshProvisionedDomain, removeProvisionedDomain, verifyManualDomain } from "./custom-domain.provider.js";

export const domainsRouter = Router();
domainsRouter.use(requireAuth);

function domainSettings(vendor: { slug: string; customDomains: unknown[] }, planContext: Awaited<ReturnType<typeof getVendorPlanContext>>) {
  return {
    plan: planContext ? { id: planContext.plan.id, code: planContext.plan.code, name: planContext.plan.name } : null,
    subscriptionStatus: planContext?.subscription.status ?? null,
    canUseCustomDomain: planContext?.subscription.status === "ACTIVE" && Boolean(planContext.entitlements.customDomain),
    hostedUrl: `${env.APP_ORIGIN.replace(/\/$/, "")}/book/${vendor.slug}`,
    cnameTarget: env.CUSTOM_DOMAIN_CNAME_TARGET,
    aTarget: env.CUSTOM_DOMAIN_A_TARGET ?? null,
    dnsRecords: [
      ...(env.CUSTOM_DOMAIN_A_TARGET ? [{ type: "A", host: "@ or your chosen subdomain", value: env.CUSTOM_DOMAIN_A_TARGET, recommended: true }] : []),
      { type: "CNAME", host: "your chosen subdomain", value: env.CUSTOM_DOMAIN_CNAME_TARGET, recommended: !env.CUSTOM_DOMAIN_A_TARGET }
    ],
    provider: env.CUSTOM_DOMAIN_PROVIDER,
    providerReady: customDomainProviderReady(),
    domains: vendor.customDomains
  };
}

function reservedHostname(hostname: string) {
  const platform = env.PLATFORM_DOMAIN.toLowerCase().replace(/^\./, "");
  return hostname === platform || hostname.endsWith(`.${platform}`) || hostname === env.CUSTOM_DOMAIN_CNAME_TARGET.toLowerCase();
}

domainsRouter.get("/", requireRole(UserRole.VENDOR_ADMIN), async (req, res) => {
  const vendorId = req.user?.vendorId;
  if (!vendorId) return res.status(403).json({ error: "Missing tenant" });
  const vendor = await prisma.vendor.findUnique({
    where: { id: vendorId },
    select: { slug: true, customDomains: { orderBy: { createdAt: "desc" } } }
  });
  if (!vendor) return res.status(404).json({ error: "Vendor not found" });
  return res.json(domainSettings(vendor, await getVendorPlanContext(vendorId)));
});

domainsRouter.post(
  "/",
  requireRole(UserRole.VENDOR_ADMIN),
  validateBody(z.object({ hostname: z.string().min(4).max(253) })),
  async (req, res) => {
    const vendorId = req.user?.vendorId;
    if (!vendorId) return res.status(403).json({ error: "Missing tenant" });
    const hostname = normalizeHostname(req.body.hostname);
    if (!hostname || reservedHostname(hostname)) return res.status(400).json({ error: "Enter a valid external hostname" });

    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, include: { customDomains: true } });
    if (!vendor) return res.status(404).json({ error: "Vendor not found" });
    let planContext;
    try {
      planContext = await requireActiveVendorEntitlements(vendorId);
    } catch (error) {
      return res.status(403).json({ error: error instanceof Error ? error.message : "An active paid subscription is required" });
    }
    if (!planContext.entitlements.customDomain) return res.status(403).json({ error: `${planContext.plan.name} does not include custom domains` });
    if (vendor.customDomains.length > 0) return res.status(409).json({ error: "Remove the current custom domain before adding another" });

    try {
      const provisioned = await provisionCustomDomain(hostname);
      const domain = await prisma.$transaction(async (tx) => {
        const created = await tx.vendorDomain.create({
          data: {
            vendorId,
            hostname,
            cnameTarget: env.CUSTOM_DOMAIN_CNAME_TARGET,
            provider: provisioned.provider,
            providerId: provisioned.providerId,
            status: provisioned.status,
            sslStatus: provisioned.sslStatus,
            verificationRecords: provisioned.verificationRecords as Prisma.InputJsonValue,
            verifiedAt: provisioned.status === DomainStatus.ACTIVE ? new Date() : undefined
          }
        });
        await tx.auditLog.create({
          data: { vendorId, actorUserId: req.user?.id, action: "custom_domain_added", entityType: "VendorDomain", entityId: created.id, metadata: { hostname } }
        });
        return created;
      });
      return res.status(201).json(domain);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return res.status(409).json({ error: "This domain is already connected to another vendor" });
      }
      return res.status(502).json({ error: error instanceof Error ? error.message : "Could not provision custom domain" });
    }
  }
);

domainsRouter.post("/:id/refresh", requireRole(UserRole.VENDOR_ADMIN), async (req, res) => {
  const vendorId = req.user?.vendorId;
  if (!vendorId) return res.status(403).json({ error: "Missing tenant" });
  const domain = await prisma.vendorDomain.findFirst({ where: { id: String(req.params.id), vendorId } });
  if (!domain) return res.status(404).json({ error: "Domain not found" });
  if (domain.provider === "manual") {
    try {
      const verification = await verifyManualDomain(domain.hostname);
      const updated = await prisma.vendorDomain.update({
        where: { id: domain.id },
        data: { status: verification.verified ? DomainStatus.ACTIVE : DomainStatus.PENDING, sslStatus: verification.verified ? "provisioning" : "pending", lastCheckedAt: new Date(), verifiedAt: verification.verified ? domain.verifiedAt ?? new Date() : domain.verifiedAt }
      });
      return res.json({ ...updated, dnsCheck: verification });
    } catch (error) {
      return res.status(502).json({ error: error instanceof Error ? error.message : "Could not check DNS records" });
    }
  }
  try {
    const refreshed = await refreshProvisionedDomain(domain.provider, domain.providerId);
    const updated = await prisma.vendorDomain.update({
      where: { id: domain.id },
      data: {
        status: refreshed.status,
        sslStatus: refreshed.sslStatus,
        verificationRecords: refreshed.verificationRecords as Prisma.InputJsonValue,
        lastCheckedAt: new Date(),
        verifiedAt: refreshed.status === DomainStatus.ACTIVE ? domain.verifiedAt ?? new Date() : domain.verifiedAt
      }
    });
    return res.json(updated);
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : "Could not refresh domain status" });
  }
});

domainsRouter.delete("/:id", requireRole(UserRole.VENDOR_ADMIN), async (req, res) => {
  const vendorId = req.user?.vendorId;
  if (!vendorId) return res.status(403).json({ error: "Missing tenant" });
  const domain = await prisma.vendorDomain.findFirst({ where: { id: String(req.params.id), vendorId } });
  if (!domain) return res.status(404).json({ error: "Domain not found" });
  try {
    await removeProvisionedDomain(domain.provider, domain.providerId);
    await prisma.$transaction(async (tx) => {
      await tx.vendorDomain.delete({ where: { id: domain.id } });
      await tx.auditLog.create({
        data: { vendorId, actorUserId: req.user?.id, action: "custom_domain_removed", entityType: "VendorDomain", entityId: domain.id, metadata: { hostname: domain.hostname } }
      });
    });
    return res.sendStatus(204);
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : "Could not remove custom domain" });
  }
});

domainsRouter.patch(
  "/admin/:id/status",
  requireRole(UserRole.SUPER_ADMIN),
  validateBody(z.object({ status: z.enum(["PENDING", "ACTIVE", "FAILED", "DISABLED"]) })),
  async (req, res) => {
    const domain = await prisma.vendorDomain.findUnique({ where: { id: String(req.params.id) } });
    if (!domain) return res.status(404).json({ error: "Domain not found" });
    const status = req.body.status as DomainStatus;
    const updated = await prisma.vendorDomain.update({
      where: { id: domain.id },
      data: { status, sslStatus: status === DomainStatus.ACTIVE ? "active" : domain.sslStatus, verifiedAt: status === DomainStatus.ACTIVE ? new Date() : domain.verifiedAt }
    });
    await prisma.auditLog.create({
      data: { vendorId: domain.vendorId, actorUserId: req.user?.id, action: "custom_domain_status_changed", entityType: "VendorDomain", entityId: domain.id, metadata: { status } }
    });
    return res.json(updated);
  }
);
