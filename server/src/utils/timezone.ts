type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
};

const weekdayNumbers: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timezone: string) {
  let value = formatters.get(timezone);
  if (!value) {
    value = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23"
    });
    formatters.set(timezone, value);
  }
  return value;
}

export function zonedParts(date: Date, timezone: string): ZonedParts {
  const parts = Object.fromEntries(formatter(timezone).formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: weekdayNumbers[parts.weekday]
  };
}

export function zonedDateTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timezone: string) {
  const desiredWallClock = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = new Date(desiredWallClock);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = zonedParts(candidate, timezone);
    const actualWallClock = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute);
    const difference = desiredWallClock - actualWallClock;
    if (difference === 0) return candidate;
    candidate = new Date(candidate.getTime() + difference);
  }
  return candidate;
}

export function zonedDateStorage(date: Date, timezone: string) {
  const parts = zonedParts(date, timezone);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

export function formatInTimezone(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}
