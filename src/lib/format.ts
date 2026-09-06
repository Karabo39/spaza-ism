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
  return new Intl.DateTimeFormat("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "medium", timeStyle: "short" }).format(d);
}

export function dateOnly(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "medium" }).format(d);
}

/** Maps raw Postgres RPC error messages to friendly, actionable text. */
export function friendlyError(message: string | undefined | null): string {
  const m = message ?? "";
  if(m.includes("NO_SHORTAGE_USE_NORMAL_UNPACK"))return "Recorded stock is sufficient. Turn off the count override and use normal unpacking.";
  if(m.includes("COUNT_AND_REASON_REQUIRED"))return "Enter the physical pack count and a reason. The count must cover the packs being unpacked.";
  if(m.includes("EXPIRY_DATE_REQUIRED"))return "Enter the expiry date for the newly counted stock.";
  if (m.includes("CREDIT_EXCEEDS_AVAILABLE")) return "This amount exceeds unused return credit or the target invoice balance.";
  if (m.includes("CREDIT_SOURCE_EQUALS_TARGET")) return "Choose a different invoice to use this return credit.";
  if (m.includes("RETURN_EXCEEDS_SOLD_QUANTITY")) return "This quantity exceeds what was sold, including earlier pending or approved returns.";
  if (m.includes("REASON_AND_INSPECTION_REQUIRED")) return "Enter both the reason for return and the inspection findings.";
  if (m.includes("RETURN_REQUIRES_QUARANTINE")) return "Only goods in good condition with a valid expiry date may return to saleable stock.";
  if (m.includes("REFUND_EXCEEDS_AVAILABLE_CREDIT")) return "The refund exceeds the approved, unrefunded credit available after other amounts owed.";
  if (m.includes("RETURN_APPROVAL_REQUIRED")) return "A manager must approve this return before a refund can be recorded.";
  if (m.includes("SELECT_INVOICE_FOR_PAYMENT")) return "This customer has unpaid invoices. Open Invoices and allocate the payment to an invoice.";
  if (m.includes("PAYMENT_EXCEEDS_OUTSTANDING")) return "The payment is more than the amount outstanding.";
  if (m.includes("CREDIT_EXCEEDS_INVOICE")) return "This credit exceeds the invoice's remaining value. Check earlier credit notes.";
  if (m.includes("INVOICE_PAYMENT_REQUIRED")) return "Record the full payment before releasing these goods.";
  if (m.includes("CREDITED_INVOICE_CANNOT_ISSUE_GOODS")) return "This invoice has a credit note. Reconcile or replace it before releasing goods.";
  if (m.includes("ORDER_NOT_CONFIRMED")) return "Confirm the order before creating an invoice.";
  if (m.includes("INVOICE_EXISTS")) return "This order already has an invoice. Open Invoices to continue.";
  if (m.includes("USE_CREDIT_NOTE_OR_RETURN")) return "This invoice has payments, notes or released goods. Use a credit note or return to correct it.";
  if (m.includes("INVALID_DISCOUNT")) return "The discount must be between zero and the order subtotal.";
  if (m.includes("INVALID_OVERRIDE_CODE_FORMAT")) return "Use a personal code of 6–12 digits.";
  if (m.includes("INVALID_OVERRIDE_CODE")) return "The manager or approval code is incorrect.";
  if (m.includes("OVERRIDE_RATE_LIMITED")) return "Too many incorrect codes. Try again in 15 minutes.";
  if (m.includes("EXPIRY_REQUIRED")) return "Enter an expiry date for products with expiry tracking.";
  if (m.includes("INVALID_TRANSFER_STATE")) return "This transfer has moved to another stage. Refresh its status before continuing.";
  if (m.includes("REASON_REQUIRED")) return "Enter a reason before continuing.";
  if (m.includes("PRODUCT_UNITS_MISMATCH")) return "The products must use matching units and expiry tracking.";
  if (m.includes("BATCH_QUANTITY_MISSING")) return "Expiry batches do not cover this quantity. Ask a manager to check the source stock.";
  if (m.includes("REQUEST_CONFLICT")) return "This request was already used with different details. Refresh before trying again.";
  if (m.includes("LOCATION_NOT_SALEABLE")) return "Warehouse stock cannot be sold. Switch to a selling store.";
  if (m.includes("INVALID_LOCATION")) return "Choose active locations belonging to this business.";
  if (m.includes("OWNER_HAS_ALL_LOCATIONS")) return "Owners already have access to every location.";
  if (m.includes("INSUFFICIENT_STOCK")) return "Not enough stock to complete this sale.";
  if (m.includes("CREDIT_LIMIT_EXCEEDED")) return "This sale exceeds the customer's credit limit.";
  if (m.includes("OVERRIDE_NOT_AUTHORIZED")) return "This approval has expired, was used, or does not cover the sale. Ask a manager or owner to approve again.";
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
