export function normalizePhoneNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^\d]/g, "");
  if (!digits) return trimmed;

  if (digits.startsWith("251") && digits.length >= 12) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 10) return `+251${digits.slice(1)}`;
  if (digits.startsWith("9") && digits.length === 9) return `+251${digits}`;
  if (hasPlus) return `+${digits}`;
  return digits;
}

export function normalizePhone(value?: string | null) {
  if (!value) return null;
  const normalized = normalizePhoneNumber(value);
  return normalized ? normalized : null;
}

export function maskPhone(value: string) {
  const normalized = normalizePhoneNumber(value);
  if (normalized.length <= 7) return normalized;
  return `${normalized.slice(0, 5)}****${normalized.slice(-3)}`;
}

export function phoneSearchTerms(value: string) {
  const normalized = normalizePhoneNumber(value);
  const digits = value.replace(/[^\d]/g, "");
  const localFromInternational = normalized.startsWith("+2519") ? `0${normalized.slice(4)}` : undefined;
  return [...new Set([
    value.trim(),
    normalized,
    digits,
    digits.startsWith("0") ? `+251${digits.slice(1)}` : undefined,
    digits.startsWith("2519") ? `0${digits.slice(3)}` : undefined,
    localFromInternational
  ].filter(Boolean) as string[])];
}
