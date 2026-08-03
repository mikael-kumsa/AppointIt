export function money(cents: number) {
  return new Intl.NumberFormat("en-ET", { style: "currency", currency: "ETB" }).format(cents / 100);
}
