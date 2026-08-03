export type TimeWindow = { start: Date; end: Date };

export function overlaps(a: TimeWindow, b: TimeWindow) {
  return a.start < b.end && b.start < a.end;
}

export function isInsideMinutesWindow(startMinute: number, endMinute: number, windowStart: string, windowEnd: string) {
  const [startHour, startMin] = windowStart.split(":").map(Number);
  const [endHour, endMin] = windowEnd.split(":").map(Number);
  return startMinute >= startHour * 60 + startMin && endMinute <= endHour * 60 + endMin;
}

export function hasTenantIsolation<T extends { vendorId: string }>(items: T[], vendorId: string) {
  return items.every((item) => item.vendorId === vendorId);
}
