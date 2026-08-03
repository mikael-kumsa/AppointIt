import { describe, expect, it } from "vitest";
import { hasTenantIsolation, isInsideMinutesWindow, overlaps } from "../src/modules/availability/booking-rules.js";

describe("booking rules", () => {
  it("detects overlapping appointments", () => {
    expect(overlaps(
      { start: new Date("2026-06-25T09:00:00Z"), end: new Date("2026-06-25T10:00:00Z") },
      { start: new Date("2026-06-25T09:30:00Z"), end: new Date("2026-06-25T10:30:00Z") }
    )).toBe(true);
  });

  it("allows appointments that touch but do not overlap", () => {
    expect(overlaps(
      { start: new Date("2026-06-25T09:00:00Z"), end: new Date("2026-06-25T10:00:00Z") },
      { start: new Date("2026-06-25T10:00:00Z"), end: new Date("2026-06-25T10:30:00Z") }
    )).toBe(false);
  });

  it("validates staff working hours including service duration and buffer math", () => {
    expect(isInsideMinutesWindow(9 * 60, 10 * 60 + 15, "09:00", "17:00")).toBe(true);
    expect(isInsideMinutesWindow(8 * 60 + 45, 9 * 60 + 30, "09:00", "17:00")).toBe(false);
  });

  it("guards multi-tenant result sets", () => {
    expect(hasTenantIsolation([{ vendorId: "a" }, { vendorId: "a" }], "a")).toBe(true);
    expect(hasTenantIsolation([{ vendorId: "a" }, { vendorId: "b" }], "a")).toBe(false);
  });
});
