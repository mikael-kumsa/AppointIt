import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db.js", () => ({
  prisma: { vendorDomain: { findFirst: vi.fn() } }
}));

import { prisma } from "../src/db.js";
import { allowCorsOrigin } from "../src/middleware/cors-origin.js";

beforeEach(() => vi.clearAllMocks());

describe("custom-domain CORS", () => {
  it("allows the platform origin and rejects unknown hosts", async () => {
    expect(await allowCorsOrigin("http://localhost:4200")).toBe(true);
    vi.mocked(prisma.vendorDomain.findFirst).mockResolvedValue(null);
    expect(await allowCorsOrigin("https://unknown.example")).toBe(false);
  });

  it("allows an active custom hostname resolved from the database", async () => {
    vi.mocked(prisma.vendorDomain.findFirst).mockResolvedValue({ id: "domain-1" } as any);
    expect(await allowCorsOrigin("https://book.selam.example")).toBe(true);
    expect(prisma.vendorDomain.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ hostname: "book.selam.example", status: "ACTIVE" })
    }));
  });
});
