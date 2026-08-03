import { Prisma } from "@prisma/client";

export type ReminderSettings = {
  automaticEnabled: boolean;
  offsetsMinutes: number[];
};

export const defaultReminderSettings: ReminderSettings = {
  automaticEnabled: true,
  offsetsMinutes: [1440, 120]
};

export function normalizeReminderOffsets(values: number[]) {
  return [...new Set(values.filter((value) => Number.isInteger(value) && value >= 15 && value <= 10_080))]
    .sort((left, right) => right - left)
    .slice(0, 6);
}

export function reminderSettings(settings: Prisma.JsonValue | null | undefined): ReminderSettings {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return defaultReminderSettings;
  const stored = (settings as Record<string, unknown>).reminderSettings;
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return defaultReminderSettings;
  const values = stored as Record<string, unknown>;
  const offsets = Array.isArray(values.offsetsMinutes) ? normalizeReminderOffsets(values.offsetsMinutes.map(Number)) : defaultReminderSettings.offsetsMinutes;
  return {
    automaticEnabled: typeof values.automaticEnabled === "boolean" ? values.automaticEnabled : defaultReminderSettings.automaticEnabled,
    offsetsMinutes: offsets.length ? offsets : []
  };
}

export function reminderType(offsetMinutes: number) {
  return `reminder_${offsetMinutes}m`;
}
