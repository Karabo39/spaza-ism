export type PaymentMode = "CASH" | "CARD" | "EFT" | "SPLIT" | "CREDIT";
export type Payment = {
  method: "CASH" | "CARD" | "EFT";
  amount: number;
  reference?: string;
  confirmed?: boolean;
};
export type PaymentDraft = {
  cash: string;
  card: string;
  eft: string;
  cardReference: string;
  eftReference: string;
  cardConfirmed: boolean;
  eftConfirmed: boolean;
};
export const emptyPayments: PaymentDraft = {
  cash: "",
  card: "",
  eft: "",
  cardReference: "",
  eftReference: "",
  cardConfirmed: false,
  eftConfirmed: false,
};
export function paymentSummary(
  mode: PaymentMode,
  draft: PaymentDraft,
  total: number,
) {
  const payments: Payment[] = [];
  let error = "";
  for (const method of ["CASH", "CARD", "EFT"] as const) {
    if (mode !== method && mode !== "SPLIT") continue;
    const raw = draft[method.toLowerCase() as "cash" | "card" | "eft"].trim();
    if (!raw) continue;
    if (
      !/^\d+(\.\d{1,2})?$/.test(raw) ||
      !Number.isFinite(Number(raw)) ||
      Number(raw) > 999999999999.99
    ) {
      error = "Enter valid payment amounts with no more than two decimals.";
      continue;
    }
    const amount = Number(raw);
    if (!amount) continue;
    const key = method === "CARD" ? "card" : "eft";
    const confirmed = method === "CASH" || draft[`${key}Confirmed`];
    if (!confirmed)
      error = `Confirm that the ${method === "CARD" ? "card" : "EFT"} payment succeeded.`;
    payments.push({
      method,
      amount,
      ...(method === "CASH"
        ? {}
        : { confirmed, reference: draft[`${key}Reference`].trim() }),
    });
  }
  const cents = (n: number) => Math.round(n * 100);
  const totalCents = cents(total);
  const paid = payments.reduce((sum, p) => sum + cents(p.amount), 0);
  const noncash = payments
    .filter((p) => p.method !== "CASH")
    .reduce((sum, p) => sum + cents(p.amount), 0);
  const cash = payments.find((p) => p.method === "CASH");
  if (
    mode !== "CREDIT" &&
    (noncash > totalCents || (cash && noncash >= totalCents))
  )
    error =
      "Card and EFT cannot exceed the balance due. Remove any unnecessary cash payment.";
  const remaining = Math.max(0, totalCents - paid) / 100;
  const change = cash ? Math.max(0, paid - totalCents) / 100 : 0;
  return {
    payments,
    received: paid / 100,
    remaining,
    change,
    error,
    valid:
      total > 0 &&
      Number.isFinite(total) &&
      (mode === "CREDIT" || (!error && remaining === 0 && payments.length > 0)),
  };
}
export type SaleReceipt = {
  id: string;
  reference: string;
  store: string;
  business: string;
  currency: string;
  cashier: string;
  cashier_id: string;
  till: string | null;
  created_at: string;
  status: string;
  total: number;
  discount: number;
  tax: number | null;
  cash_tendered: number;
  change: number;
  items: {
    name: string;
    unit: string;
    quantity: number;
    unit_price: number;
    total: number;
  }[];
  payments: { method: string; amount: number; reference: string | null }[];
};
