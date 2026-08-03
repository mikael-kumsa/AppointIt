import { DomainStatus } from "@prisma/client";
import { env } from "../../config/env.js";
import { promises as dns } from "node:dns";

export type DomainVerificationRecord = {
  type: string;
  name: string;
  value: string;
  purpose: "ownership" | "ssl";
};

export type ProvisionedDomain = {
  provider: "manual" | "cloudflare";
  providerId?: string;
  status: DomainStatus;
  sslStatus: string;
  verificationRecords: DomainVerificationRecord[];
};

type CloudflareHostname = {
  id?: string;
  status?: string;
  ownership_verification?: { type?: string; name?: string; value?: string };
  ssl?: {
    status?: string;
    validation_records?: Array<{ txt_name?: string; txt_value?: string; http_url?: string; http_body?: string }>;
  };
};

function cloudflareConfigured() {
  return env.CUSTOM_DOMAIN_PROVIDER === "cloudflare" && Boolean(env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ZONE_ID);
}

function records(result: CloudflareHostname): DomainVerificationRecord[] {
  const output: DomainVerificationRecord[] = [];
  const ownership = result.ownership_verification;
  if (ownership?.name && ownership.value) {
    output.push({ type: ownership.type?.toUpperCase() ?? "TXT", name: ownership.name, value: ownership.value, purpose: "ownership" });
  }
  for (const record of result.ssl?.validation_records ?? []) {
    if (record.txt_name && record.txt_value) {
      output.push({ type: "TXT", name: record.txt_name, value: record.txt_value, purpose: "ssl" });
    } else if (record.http_url && record.http_body) {
      output.push({ type: "HTTP", name: record.http_url, value: record.http_body, purpose: "ssl" });
    }
  }
  return output;
}

function mapResult(result: CloudflareHostname): ProvisionedDomain {
  const sslStatus = result.ssl?.status ?? "pending";
  const active = result.status === "active" && sslStatus === "active";
  const failed = ["blocked", "moved", "deleted"].includes(result.status ?? "");
  return {
    provider: "cloudflare",
    providerId: result.id,
    status: active ? DomainStatus.ACTIVE : failed ? DomainStatus.FAILED : DomainStatus.PENDING,
    sslStatus,
    verificationRecords: records(result)
  };
}

async function cloudflareRequest(path: string, init?: RequestInit) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${env.CLOUDFLARE_ZONE_ID}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      "content-type": "application/json",
      ...init?.headers
    }
  });
  const payload = await response.json().catch(() => ({})) as {
    success?: boolean;
    errors?: Array<{ message?: string }>;
    result?: CloudflareHostname;
  };
  if (!response.ok || !payload.success || !payload.result) {
    throw new Error(payload.errors?.map((item) => item.message).filter(Boolean).join(" ") || "Custom-domain provider request failed");
  }
  return payload.result;
}

export function customDomainProviderReady() {
  return env.CUSTOM_DOMAIN_PROVIDER === "manual" || cloudflareConfigured();
}

export async function verifyManualDomain(hostname: string) {
  const expectedCname = env.CUSTOM_DOMAIN_CNAME_TARGET.toLowerCase().replace(/\.$/, "");
  const expectedIp = env.CUSTOM_DOMAIN_A_TARGET;
  const [cnames, addresses] = await Promise.all([
    dns.resolveCname(hostname).catch(() => [] as string[]),
    dns.resolve4(hostname).catch(() => [] as string[])
  ]);
  const cnameMatches = cnames.some((value) => value.toLowerCase().replace(/\.$/, "") === expectedCname);
  const addressMatches = Boolean(expectedIp && addresses.includes(expectedIp));
  return { verified: cnameMatches || addressMatches, cnames, addresses };
}

export async function provisionCustomDomain(hostname: string): Promise<ProvisionedDomain> {
  if (env.CUSTOM_DOMAIN_PROVIDER === "manual") {
    return { provider: "manual", status: DomainStatus.PENDING, sslStatus: "pending", verificationRecords: [] };
  }
  if (!cloudflareConfigured()) throw new Error("Cloudflare custom-domain credentials are not configured");
  return mapResult(await cloudflareRequest("/custom_hostnames", {
    method: "POST",
    body: JSON.stringify({ hostname, ssl: { method: "http", type: "dv" } })
  }));
}

export async function refreshProvisionedDomain(provider: string, providerId?: string | null): Promise<ProvisionedDomain> {
  if (provider === "manual") {
    return { provider: "manual", status: DomainStatus.PENDING, sslStatus: "pending", verificationRecords: [] };
  }
  if (!providerId || !cloudflareConfigured()) throw new Error("Cloudflare custom-domain connection is incomplete");
  return mapResult(await cloudflareRequest(`/custom_hostnames/${encodeURIComponent(providerId)}`));
}

export async function removeProvisionedDomain(provider: string, providerId?: string | null) {
  if (provider === "manual" || !providerId) return;
  if (!cloudflareConfigured()) throw new Error("Cloudflare custom-domain credentials are not configured");
  const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${env.CLOUDFLARE_ZONE_ID}/custom_hostnames/${encodeURIComponent(providerId)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` }
  });
  if (!response.ok) throw new Error("Could not remove custom hostname from Cloudflare");
}
