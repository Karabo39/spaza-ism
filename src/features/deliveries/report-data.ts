import type { Json } from "@/lib/db/database.types";
export const DELIVERY_STATUSES = {
  PENDING: "Pending Delivery",
  SCHEDULED: "Scheduled",
  OUT_FOR_DELIVERY: "Out for Delivery",
  DELIVERED: "Delivered / Completed",
  RESCHEDULED: "Rescheduled",
  FAILED: "Failed Delivery",
  CANCELLED: "Cancelled",
} as const;
export type DeliveryReportRow = {
  sequence: number;
  delivery_id: string;
  order_id: string;
  invoice_id: string;
  store_id: string;
  delivery_number: string;
  order_number: string;
  invoice_number: string;
  customer_name: string;
  customer_contact: string;
  store_name: string;
  driver_name: string | null;
  vehicle_registration: string | null;
  order_date: string;
  delivery_date: string;
  scheduled_date: string;
  delivery_status: keyof typeof DELIVERY_STATUSES;
  order_total: number;
  currency: string;
  payment_status: string;
  attempt_count: number;
  rescheduled_date: string | null;
  cancellation_reason: string | null;
  failure_reason: string | null;
  confirmed_by: string | null;
  received_by: string | null;
  comments: string | null;
  delivered_at: string | null;
};
export type DeliverySummary = {
  total: number;
  delivered: number;
  pending: number;
  scheduled: number;
  out_for_delivery: number;
  rescheduled: number;
  failed: number;
  cancelled: number;
  values: { currency: string; total: number }[];
};
export type DeliveryReportPage = {
  rows: DeliveryReportRow[];
  next: number | null;
  until: number;
  summary: DeliverySummary | null;
  generated_at: string;
};
export type ReportFilters = Record<string, string>;
export type ReportMode = "view" | "print" | "xlsx" | "pdf";
export const reportColumns = [
  ["delivery_number", "Delivery Note Number"],
  ["order_number", "Order Number"],
  ["invoice_number", "Invoice Number"],
  ["customer_name", "Customer Name"],
  ["customer_contact", "Customer Contact Number"],
  ["store_name", "Store / Branch"],
  ["driver_name", "Driver Name"],
  ["vehicle_registration", "Vehicle Registration"],
  ["order_date", "Order Date"],
  ["delivery_date", "Delivery Note Date"],
  ["scheduled_date", "Scheduled Delivery Date"],
  ["delivery_status", "Delivery Status"],
  ["order_total", "Order Total"],
  ["currency", "Currency"],
  ["payment_status", "Payment Status"],
  ["attempt_count", "Delivery Attempt Count"],
  ["rescheduled_date", "Last Rescheduled Date"],
  ["cancellation_reason", "Cancellation Reason"],
  ["failure_reason", "Last Failure Reason"],
  ["confirmed_by", "Confirmed By"],
  ["delivered_by", "Delivered By (Driver)"],
  ["received_by", "Receiver Name"],
  ["delivered_at", "Delivered / Confirmed At"],
  ["comments", "Delivery Comments / Notes"],
].map(([key, label]) => ({ key, label }));
export const summaryLabels = {
  total: "Total Deliveries",
  delivered: "Delivered",
  pending: "Pending",
  scheduled: "Scheduled",
  out_for_delivery: "Out for Delivery",
  rescheduled: "Rescheduled",
  failed: "Failed",
  cancelled: "Cancelled",
} as const;
export function exportRow(row: DeliveryReportRow): Record<string, unknown> {
  return {
    ...row,
    delivered_by: row.delivery_status === "DELIVERED" ? row.driver_name : null,
    delivery_status: DELIVERY_STATUSES[row.delivery_status],
    payment_status: row.payment_status.replaceAll("_", " "),
  };
}
export function displayReportValue(key: string, value: unknown) {
  return key === "order_total"
    ? Number(value).toFixed(2)
    : String(value ?? "—");
}
export function describeFilters(filters: ReportFilters, stores: string[]) {
  return [
    `Branches: ${stores.join(", ")}`,
    ...Object.entries(filters)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k.replaceAll("_", " ")}: ${v}`),
  ].join(" · ");
}
export async function collectDeliveryReport(
  fetchPage: (
    after: number | null,
    until: number | null,
  ) => Promise<DeliveryReportPage>,
) {
  const first = await fetchPage(null, null);
  let next = first.next;
  const rows = [...first.rows];
  const seen = new Set<number>();
  while (next !== null) {
    if (seen.has(next)) throw Error("Report pagination did not advance");
    seen.add(next);
    const page = await fetchPage(next, first.until);
    rows.push(...page.rows);
    next = page.next;
  }
  return { ...first, rows };
}
export function reportArgs(
  stores: string[],
  filters: ReportFilters,
  mode: ReportMode,
  after: number | null = null,
  until: number | null = null,
) {
  return {
    p_stores: stores,
    p_filters: filters as Json,
    p_mode: mode,
    p_after: after,
    p_until: until,
    p_limit: mode === "view" ? 50 : 200,
  };
}
