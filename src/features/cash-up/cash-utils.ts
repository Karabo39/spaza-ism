export const DENOMINATIONS = [
  200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01,
];
export function amountCents(value: string): number | null {
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
export function denominationCents(
  counts: Record<string, string>,
): number | null {
  let cents = 0;
  for (const [denomination, count] of Object.entries(counts)) {
    if (
      !DENOMINATIONS.includes(Number(denomination)) ||
      (count && !/^\d{1,7}$/.test(count))
    )
      return null;
    cents += Math.round(Number(denomination) * 100) * Number(count || 0);
  }
  return cents;
}
export function cashError(message: string): string {
  const messages: Record<string, string> = {
    SHIFT_LOCKED:
      "A later shift has started. This approved shift is kept read-only.",
    SHIFT_APPROVAL_REQUIRED:
      "Approve the current cash-up before starting another shift.",
    SHIFT_ALREADY_STARTED:
      "Another shift has already started. Refresh to view it.",
    SHIFT_DATE_NOT_TODAY: "New shifts can only be started for today.",
    HANDOVER_NOTE_REQUIRED:
      "Explain why the new opening cash differs from the previous count.",
    CASH_ACTIVITY_CHANGED:
      "Cash activity or the opening float changed. Refresh, check the latest total and count again.",
    CASH_UP_CHANGED: "This cash-up has changed. Refresh before continuing.",
    CASH_UP_NOT_OPEN:
      "This count has already been submitted. A manager must reopen it before another count.",
    CASH_UP_ALREADY_OPEN:
      "A cash-up already exists for this date with a different float. Refresh to open it.",
    UNCLASSIFIED_PAYMENTS:
      "A manager must identify the payment methods shown below before you submit.",
    VARIANCE_NOTE_REQUIRED: "Explain the cash difference before continuing.",
    INVALID_CASH_AMOUNT:
      "Enter a valid amount with no more than two decimal places.",
    CASH_COUNT_MISMATCH:
      "The denomination count does not match the total. Check your count.",
    INVALID_DENOMINATIONS:
      "Enter whole numbers for the number of notes and coins.",
    REASON_REQUIRED: "Enter a reason before continuing.",
    FORBIDDEN: "You do not have permission to do this at this store.",
    PAYMENT_ALREADY_CLASSIFIED:
      "This payment already has a recorded method. Refresh its details.",
    REQUEST_CONFLICT:
      "This attempt was already recorded with different details. Refresh before continuing.",
  };
  return (
    Object.entries(messages).find(([code]) => message.includes(code))?.[1] ??
    "Could not confirm this action. Refresh its status before retrying."
  );
}
