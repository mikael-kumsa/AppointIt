import { DomainStatus, VendorStatus } from "@prisma/client";
import { env } from "../config/env.js";
import { prisma } from "../db.js";
import { normalizeHostname } from "../utils/hostname.js";
import { activeCustomDomainSubscriptionWhere } from "../modules/plans/plans.service.js";

const appOrigin = new URL(env.APP_ORIGIN).origin;

export async function allowCorsOrigin(origin?: string) {
  if (!origin) return true;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.origin === appOrigin) return true;
  if (parsed.protocol !== "https:") return false;
  const hostname = normalizeHostname(parsed.hostname);
  if (!hostname) return false;
  const domain = await prisma.vendorDomain.findFirst({
    where: {
      hostname,
      status: DomainStatus.ACTIVE,
      vendor: { subscription: activeCustomDomainSubscriptionWhere, status: { in: [VendorStatus.ACTIVE, VendorStatus.TRIAL] } }
    },
    select: { id: true }
  });
  return Boolean(domain);
}
