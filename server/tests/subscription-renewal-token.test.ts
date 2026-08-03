import { describe, expect, it } from "vitest";
import { signRenewalToken, verifyRenewalToken } from "../src/modules/auth/auth.service.js";

describe("subscription renewal token", () => {
  it("carries only the restricted renewal identity", () => {
    const token = signRenewalToken("owner-1", "vendor-1");
    expect(verifyRenewalToken(token)).toEqual({ userId: "owner-1", vendorId: "vendor-1" });
  });

  it("rejects an ordinary access token payload", () => {
    expect(() => verifyRenewalToken("not-a-jwt")).toThrow();
  });
});
