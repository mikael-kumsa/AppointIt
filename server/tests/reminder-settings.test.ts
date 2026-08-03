import { describe, expect, it } from "vitest";
import { normalizeReminderOffsets, reminderSettings, reminderType } from "../src/modules/notifications/reminder-settings.js";

describe("reminder settings", () => {
  it("preserves the legacy day and two-hour schedule by default", () => {
    expect(reminderSettings({})).toEqual({ automaticEnabled: true, offsetsMinutes: [1440, 120] });
  });

  it("normalizes duplicate, invalid, and unsorted custom timings", () => {
    expect(normalizeReminderOffsets([60, 10_080, 60, 14, 180, 20_000])).toEqual([10_080, 180, 60]);
  });

  it("creates stable queue types for custom offsets", () => {
    expect(reminderType(90)).toBe("reminder_90m");
  });
});
