/** Formatting helpers. Currency defaults to ZAR (spaza shops are ZA-based). */

export function money(value: number | string | null | undefined, currency = "ZAR"): string {
  const n = typeof value === "string" ? Number(value) : value ?? 0;
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(Number.isFinite(n as number) ? (n as number) : 0);
}

/** Quantities render without trailing zeros (10.000 -> "10", 1.500 -> "1.5"). */
export function qty(value: number | string | null | undefined): string {
  const n = typeof value === "string" ? Number(value) : value ?? 0;
  if (!Number.isFinite(n as number)) return "0";
  return String(Number((n as number).toFixed(3)));
}

export function dateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeStyle: "short" }).format(d);
}

export function dateOnly(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium" }).format(d);
}

/** Maps raw Postgres RPC error messages to friendly, actionable text. */
export function friendlyError(message: string | undefined | null): string {
  const m = message ?? "";
  if (m.includes("INSUFFICIENT_STOCK")) return "Not enough stock to complete this sale.";
  if (m.includes("CREDIT_LIMIT_EXCEEDED")) return "This sale exceeds the customer's credit limit.";
  if (m.includes("OVERRIDE_NOT_AUTHORIZED")) return "Only a manager or owner can override the credit limit.";
  if (m.includes("PRODUCT_NOT_FOUND_OR_INACTIVE")) return "One of the products is unavailable or inactive.";
  if (m.includes("CUSTOMER_REQUIRED")) return "Select a customer for a credit sale.";
  if (m.includes("CREDIT_ACCOUNT_NOT_FOUND")) return "That customer has no credit account.";
  if (m.includes("INVALID_QUANTITY")) return "Enter a valid quantity greater than zero.";
  if (m.includes("INVALID_AMOUNT")) return "Enter a valid amount greater than zero.";
  if (m.includes("NO_CHANGE")) return "The new quantity is the same as the current quantity.";
  if (m.includes("FORBIDDEN")) return "You don't have permission to do that.";
  if (m.includes("NO_ITEMS")) return "Add at least one item first.";
  if (m.includes("duplicate key") && m.includes("barcode")) return "That barcode is already used by another product.";
  return m || "Something went wrong. Please try again.";
}
