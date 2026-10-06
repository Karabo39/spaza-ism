"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "@/lib/store-context";
import { createClient } from "@/lib/supabase/client";
import { ExportButton } from "./export-button";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { money } from "@/lib/format";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
export const onlineMetricLabels: Record<string, string> = {
  total_orders: "Total Online Orders",
  order_value: "All order value (includes unpaid/cancelled)",
  online_sales: "Sales — goods issued",
  completed_orders: "Completed Orders",
  completed_value: "Completed order value",
  pending_orders: "Pending Orders",
  pending_value: "Pending order value",
  cancelled_orders: "Cancelled / Expired Orders",
  cancelled_value: "Cancelled / expired value",
  paid_orders: "Paid Orders",
  paid_value: "Payments confirmed (before refunds)",
  unpaid_orders: "Unpaid active Orders",
  unpaid_value: "Unpaid active order value",
  deliveries: "Deliveries",
  collections: "Collections",
  delivery_fees: "Delivery fees collected",
  discounts: "Discounts",
  tax: "Tax on goods issued",
  refund_count: "Refund transactions in period",
  refunds: "Refunds paid in period",
  average_order_value: "Average order value",
  new_customers: "New online customers",
  returning_customers: "Returning online customers",
};
export type OnlineReport = {
  from: string;
  to: string;
  metrics: Record<string, number>;
  statuses: { status: string; count: number; value: number }[];
  products: { product: string; quantity: number; value: number }[];
};
function localDate(d: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
export function OnlineOrdersReport() {
  const { store } = useStore();
  const today = localDate(new Date());
  const [range, setRange] = useState({ from: today, to: today });
  const query = useQuery({
    queryKey: ["billing", "online-report", store.id, range],
    queryFn: async () => {
      const r = await createClient().rpc("online_orders_report", {
        p_store: store.id,
        p_from: range.from,
        p_to: range.to,
      });
      if (r.error) throw r.error;
      return r.data as unknown as OnlineReport;
    },
  });
  const data = query.data;
  const rows = data
    ? [
        ...Object.keys(onlineMetricLabels)
          .map((key) => [key, data.metrics[key] ?? 0] as const)
          .map(([k, v]) => ({
            section: "Summary",
            item: onlineMetricLabels[k] ?? k,
            quantity: "",
            value: v,
          })),
        ...data.statuses.map((s) => ({
          section: "Order status",
          item: s.status.replaceAll("_", " "),
          quantity: s.count,
          value: s.value,
        })),
        ...data.products.map((p) => ({
          section: "Top-selling products (goods issued)",
          item: p.product,
          quantity: p.quantity,
          value: p.value,
        })),
      ]
    : [];
  function preset(kind: string) {
    const d = new Date(today + "T12:00:00Z");
    if (kind === "week")
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    if (kind === "month") d.setUTCDate(1);
    setRange({ from: localDate(d), to: today });
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <Button onClick={() => preset("today")}>Today</Button>
        <Button onClick={() => preset("week")}>This Week</Button>
        <Button onClick={() => preset("month")}>This Month</Button>
        <label>
          From
          <Input
            type="date"
            value={range.from}
            onChange={(e) => {
              if (e.target.value) setRange({ ...range, from: e.target.value });
            }}
          />
        </label>
        <label>
          To
          <Input
            type="date"
            value={range.to}
            onChange={(e) => {
              if (e.target.value) setRange({ ...range, to: e.target.value });
            }}
          />
        </label>
        <ExportButton
          rows={rows}
          columns={[
            { key: "section", label: "Section" },
            { key: "item", label: "Metric / product" },
            { key: "quantity", label: "Count / quantity" },
            { key: "value", label: "Value" },
          ]}
          filename={`online-orders-${range.from}-${range.to}`}
        />
      </div>
      <p className="text-sm text-muted">
        Store: {store.name} · {store.currency}. Order metrics use orders placed
        in the selected period. Refunds use their payment date. Sales and top
        products count goods issued; paid order value is shown separately.
        New/returning customers are matched within this store by email or phone.
      </p>
      {query.isLoading && <p role="status">Loading online report…</p>}
      {query.error && (
        <p role="alert">
          Could not load report. Choose a valid date range up to one year.{" "}
          <Button onClick={() => query.refetch()}>Retry</Button>
        </p>
      )}
      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Object.keys(onlineMetricLabels)
              .map((key) => [key, data.metrics[key] ?? 0] as const)
              .map(([k, v]) => (
                <div
                  key={k}
                  className="rounded-lg border border-border bg-surface p-4"
                >
                  <p className="text-sm text-muted">
                    {onlineMetricLabels[k] ?? k}
                  </p>
                  <p className="text-xl font-semibold">
                    {/(value|sales|fees|discounts|tax|refunds)$/.test(k)
                      ? money(v, store.currency)
                      : v}
                  </p>
                </div>
              ))}
          </div>
          <h2 className="font-semibold">Order Status Summary</h2>
          <Table>
            <THead>
              <TR>
                <TH>Status</TH>
                <TH>Orders</TH>
                <TH>Order value</TH>
              </TR>
            </THead>
            <TBody>
              {data.statuses.map((s) => (
                <TR key={s.status}>
                  <TD>{s.status.replaceAll("_", " ")}</TD>
                  <TD>{s.count}</TD>
                  <TD>{money(s.value, store.currency)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <h2 className="font-semibold">Top-Selling Online Products</h2>
          <p className="text-sm text-muted">
            Up to 50 products by quantity issued. Scheduled email summaries
            include the top five.
          </p>
          <Table>
            <THead>
              <TR>
                <TH>Product</TH>
                <TH>Quantity</TH>
                <TH>Sales value</TH>
              </TR>
            </THead>
            <TBody>
              {data.products.map((p, i) => (
                <TR key={i}>
                  <TD>{p.product}</TD>
                  <TD>{p.quantity}</TD>
                  <TD>{money(p.value, store.currency)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </>
      )}
    </div>
  );
}
