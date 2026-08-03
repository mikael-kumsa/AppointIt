import { describe, expect, it } from "vitest";
import { zonedDateStorage, zonedDateTimeToUtc, zonedParts } from "../src/utils/timezone.js";

describe("vendor timezone helpers", () => {
  it("converts Addis Ababa opening times to UTC", () => {
    const instant = zonedDateTimeToUtc(2026, 7, 6, 9, 0, "Africa/Addis_Ababa");
    expect(instant.toISOString()).toBe("2026-07-06T06:00:00.000Z");
    expect(zonedParts(instant, "Africa/Addis_Ababa")).toMatchObject({ weekday: 1, hour: 9, minute: 0 });
  });

  it("stores a holiday using the vendor's calendar date", () => {
    const lateEveningUtc = new Date("2026-07-05T22:30:00.000Z");
    expect(zonedDateStorage(lateEveningUtc, "Africa/Addis_Ababa").toISOString()).toBe("2026-07-06T00:00:00.000Z");
  });
});
