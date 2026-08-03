export type ParsedTelebirrCredit = {
  amountCents: number;
  currency: "ETB";
  payerName: string;
  payerPhoneMasked?: string;
  occurredAt: Date;
  transactionId: string;
};

export function normalizeTransactionId(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

export function parseTelebirrCredit(message: string): ParsedTelebirrCredit {
  const normalized = message.replace(/\r/g, "").replace(/\s+/g, " ").trim();
  const credit = normalized.match(/received\s+ETB\s+([\d,]+(?:\.\d{1,2})?)\s+from\s+(.+?)\(([^)]+)\)\s+on\s+(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/i);
  const transaction = normalized.match(/transaction\s+number\s+is\s+([A-Z0-9]{6,32})\b/i);
  if (!credit || !transaction) throw new Error("Unrecognized Telebirr credit message");

  const amount = Number(credit[1].replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Invalid Telebirr payment amount");
  const amountCents = Math.round(amount * 100);
  const [, , payerName, payerPhoneMasked, day, month, year, hour, minute, second] = credit;
  const occurredAt = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour) - 3, Number(minute), Number(second)));
  if (Number.isNaN(occurredAt.getTime())) throw new Error("Invalid Telebirr payment timestamp");

  return {
    amountCents,
    currency: "ETB",
    payerName: payerName.trim(),
    payerPhoneMasked: payerPhoneMasked.trim(),
    occurredAt,
    transactionId: normalizeTransactionId(transaction[1])
  };
}
