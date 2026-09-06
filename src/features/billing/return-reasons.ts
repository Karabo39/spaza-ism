export const DEFAULT_RETURN_REASONS = [
  "Wrong item",
  "Damaged",
  "Expired",
  "Faulty",
  "Unwanted",
  "Exchange",
  "Other",
];

export function validReturnReasons(reasons: string[]) {
  return (
    reasons.length > 0 &&
    reasons.length <= 20 &&
    reasons.every(
      (reason) =>
        reason.length > 0 &&
        reason.length <= 80 &&
        !/[:\u0000-\u001f\u007f]/.test(reason),
    ) &&
    new Set(reasons.map((reason) => reason.toLowerCase())).size ===
      reasons.length
  );
}

export function returnReasonText(category: string, detail: string) {
  return detail.trim() ? `${category}: ${detail.trim()}` : category;
}
