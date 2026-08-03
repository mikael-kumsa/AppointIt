import { beforeEach, describe, expect, it, vi } from "vitest";
import { DomainStatus } from "@prisma/client";

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv("DATABASE_URL", "postgresql://appointit:appointit@localhost:5433/appointit?schema=public");
  vi.stubEnv("CUSTOM_DOMAIN_PROVIDER", "cloudflare");
  vi.stubEnv("CLOUDFLARE_API_TOKEN", "cloudflare-token");
  vi.stubEnv("CLOUDFLARE_ZONE_ID", "zone-1");
  vi.stubGlobal("fetch", vi.fn());
});

describe("Cloudflare custom-domain provider", () => {
  it("provisions a hostname and maps active hostname and TLS status", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        result: { id: "cf-domain-1", status: "active", ssl: { status: "active" } }
      })
    } as Response);

    const { provisionCustomDomain } = await import("../src/modules/domains/custom-domain.provider.js");
    const result = await provisionCustomDomain("book.selam.example");

    expect(result).toMatchObject({ provider: "cloudflare", providerId: "cf-domain-1", status: DomainStatus.ACTIVE, sslStatus: "active" });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/zones/zone-1/custom_hostnames",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer cloudflare-token" })
      })
    );
  });

  it("returns ownership and certificate validation records", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        result: {
          id: "cf-domain-2",
          status: "pending",
          ownership_verification: { type: "txt", name: "_cf-custom-hostname.book.selam.example", value: "ownership-token" },
          ssl: { status: "pending_validation", validation_records: [{ txt_name: "_acme-challenge.book.selam.example", txt_value: "ssl-token" }] }
        }
      })
    } as Response);

    const { provisionCustomDomain } = await import("../src/modules/domains/custom-domain.provider.js");
    const result = await provisionCustomDomain("book.selam.example");

    expect(result.status).toBe(DomainStatus.PENDING);
    expect(result.verificationRecords).toEqual([
      { type: "TXT", name: "_cf-custom-hostname.book.selam.example", value: "ownership-token", purpose: "ownership" },
      { type: "TXT", name: "_acme-challenge.book.selam.example", value: "ssl-token", purpose: "ssl" }
    ]);
  });
});
