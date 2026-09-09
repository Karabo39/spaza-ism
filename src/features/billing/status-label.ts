/** Human-readable labels; database status values remain unchanged. */
export function statusLabel(value: string) {
  const label = value.toLowerCase().replaceAll("_", " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Payment status remains separate from goods release and credit-note settlement. */
export function invoiceStatusLabel(invoice: {
  status: string;
  goods_issued_at: string | null;
}) {
  return invoice.status === "PAID" && !invoice.goods_issued_at
    ? "Paid – To be Delivered"
    : statusLabel(invoice.status);
}
