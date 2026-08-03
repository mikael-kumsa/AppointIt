import { describe, expect, it } from "vitest";
import { normalizeTransactionId, parseTelebirrCredit } from "../src/modules/payments/telebirr-parser.js";

const sample = `Dear Michael
You have received ETB 400.00 from EMBET TAMIRU(2519****6985)  on 29/06/2026 08:37:55. Your transaction number is DFT3DDIXIX. Your current E-Money Account balance is ETB 434.37.
Thank you for using telebirr
Ethio telecom`;

describe("Telebirr credit parser", () => {
  it("extracts the exact payment data from a Telebirr credit SMS", () => {
    expect(parseTelebirrCredit(sample)).toEqual({
      amountCents: 40000,
      currency: "ETB",
      payerName: "EMBET TAMIRU",
      payerPhoneMasked: "2519****6985",
      occurredAt: new Date("2026-06-29T05:37:55.000Z"),
      transactionId: "DFT3DDIXIX"
    });
  });

  it("supports comma-separated amounts and irregular whitespace", () => {
    const parsed = parseTelebirrCredit("You have received ETB 1,250.50 from Abebe Kebede (2519****0000) on 30/06/2026 12:01:02. Your transaction number is abc123xyz.");
    expect(parsed.amountCents).toBe(125050);
    expect(parsed.transactionId).toBe("ABC123XYZ");
  });

  it("rejects messages that are not incoming Telebirr credits", () => {
    expect(() => parseTelebirrCredit("You have paid ETB 400.00. Your transaction number is DFT3DDIXIX.")).toThrow("Unrecognized Telebirr credit message");
  });

  it("normalizes transaction IDs before matching", () => {
    expect(normalizeTransactionId(" dft3 ddixix ")).toBe("DFT3DDIXIX");
  });
});
