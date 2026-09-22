import { dateTime } from "@/lib/format";
import { MOVEMENT_META } from "@/features/stock/movement-meta";
export type ActivityRow = {
  id: string;
  created_at: string;
  action: string;
  actor_id: string | null;
  actor_name: string | null;
  location_name: string | null;
  stock_items?: string;
  entity_type: string;
  entity_id: string;
  before_data?: unknown;
  after_data?: unknown;
  stock_type: string | null;
  movement_type: keyof typeof MOVEMENT_META;
  quantity_delta: number;
  quantity_before: number;
  quantity_after: number;
  reason: string | null;
  products: {
    name: string;
    sku: string | null;
    bulk_parent_id: string | null;
  } | null;
  sale_type: string;
  total_amount: number;
  credit_override: boolean;
  authorized_by: string | null;
  customer_name: string | null;
  cashier: string;
  approver: string | null;
  items_count: number;
  payments: { method: string; amount: number }[] | null;
};
export const paymentType = (r: ActivityRow) =>
  r.payments?.map((p) => p.method).join(" + ") || r.sale_type;
export const paymentAmount = (
  r: ActivityRow,
  methods: string[],
  legacy: string,
) =>
  r.payments
    ? r.payments
        .filter((p) => methods.includes(p.method))
        .reduce((n, p) => n + Number(p.amount), 0)
    : r.sale_type === legacy
      ? Number(r.total_amount)
      : 0;
export const approverName = (r: ActivityRow) =>
  !r.credit_override
    ? "—"
    : r.authorized_by
      ? r.approver || "User unavailable"
      : "Not recorded";

export function activityExportRow(
  kind: string,
  r: ActivityRow,
): Record<string, unknown> {
  if (kind === "audit")
    return {
      when: dateTime(r.created_at),
      action: r.action,
      location: r.location_name,
      stock: r.stock_items,
      by: r.actor_name,
      reference: r.entity_id,
      before: JSON.stringify(r.before_data),
      after: JSON.stringify(r.after_data),
    };
  if (kind === "movements")
    return {
      date: dateTime(r.created_at),
      product: r.products?.name,
      sku: r.products?.sku,
      stock_type:
        r.stock_type ??
        (r.products?.bulk_parent_id ? "Bulk Stock" : "Individual"),
      type: MOVEMENT_META[r.movement_type]?.label ?? r.movement_type,
      change: r.quantity_delta,
      before: r.quantity_before,
      after: r.quantity_after,
      reason: r.reason,
    };
  return {
    date: dateTime(r.created_at),
    type: paymentType(r),
    customer: r.customer_name,
    items: r.items_count,
    total: r.total_amount,
    override: r.credit_override ? "yes" : "",
    salesperson: r.cashier,
    approved_by: approverName(r),
  };
}
