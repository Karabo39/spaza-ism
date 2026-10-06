export type NotificationJob = {
  id: string;
  recipient: string;
  payload: {
    kind: string;
    name?: string;
    business: string;
    business_id?: string;
    store: string;
    currency: string;
    count?: number;
    rows?: Record<string, unknown>[];
    products?: Record<string, unknown>[];
    statuses?: Record<string, unknown>[];
    metrics?: Record<string, unknown>;
    from?: string;
    to?: string;
    notes?: string;
  };
};
export const notificationLabels: Record<string, string> = {
  OUT_OF_STOCK: "Out of Stock Report",
  UPCOMING_EXPIRY: "Upcoming Expiry",
  STOCK_TAKE_COMPLETED: "Completed Stock Counts",
  LOW_STOCK: "Low Stock Alert",
  WEEKLY_PROFIT: "Weekly Profit",
  OVERDUE_INVOICES: "Overdue Invoices",
  DAILY_SALES: "Daily Sales Summary",
  OUTSTANDING_PAYMENTS: "Outstanding Payments",
  STOCK_MOVEMENTS: "Stock Movement Summary",
  MOVING_PRODUCTS: "Top & Slow-Moving Products",
  CASH_UP: "Cash-Up / Financial Summary",
  ONLINE_ORDERS: "Online Orders Summary",
  BUSINESS_PERFORMANCE: "Business Performance Report",
};
type DocumentColumn = { key: string; label: string };
type DocumentSection = { title: string; columns: DocumentColumn[]; rows: Record<string, unknown>[] };
const detailColumns: Record<string, DocumentColumn[]> = {
  LOW_STOCK: [
    { key: "product", label: "Product" }, { key: "sku", label: "SKU" },
    { key: "quantity", label: "Current stock" }, { key: "min_stock_level", label: "Minimum" },
    { key: "reorder_level", label: "Reorder level" }, { key: "store", label: "Location / store" },
  ],
  OUT_OF_STOCK: [
    { key: "product", label: "Product" }, { key: "sku", label: "SKU" },
    { key: "quantity", label: "Available stock" }, { key: "store", label: "Location / store" },
  ],
  OUTSTANDING_PAYMENTS: [
    { key: "customer", label: "Customer" }, { key: "reference", label: "Invoice number" },
    { key: "invoice_date", label: "Invoice date" }, { key: "total", label: "Total amount" },
    { key: "paid", label: "Amount paid" }, { key: "outstanding", label: "Amount outstanding" },
    { key: "status", label: "Payment status" },
  ],
  OVERDUE_INVOICES: [
    { key: "customer", label: "Customer" }, { key: "reference", label: "Invoice number" },
    { key: "due_date", label: "Due date" }, { key: "total", label: "Invoice amount" },
    { key: "outstanding", label: "Amount outstanding" }, { key: "days_overdue", label: "Days overdue" },
  ],
  STOCK_MOVEMENTS: [
    { key: "product", label: "Product" }, { key: "sku", label: "SKU" },
    { key: "stock_received", label: "Stock received" }, { key: "stock_sold", label: "Stock sold" },
    { key: "stock_transferred", label: "Stock transferred" }, { key: "stock_adjusted", label: "Stock adjusted" },
    { key: "stock_returned", label: "Stock returned" }, { key: "closing_stock", label: "Closing / current stock" },
  ],
  MOVING_PRODUCTS: [
    { key: "category", label: "Movement / performance" }, { key: "product", label: "Product" },
    { key: "sku", label: "SKU" }, { key: "quantity", label: "Quantity sold" }, { key: "value", label: "Sales value" },
  ],
  ONLINE_ORDERS: [
    { key: "order_number", label: "Order number" }, { key: "customer", label: "Customer" },
    { key: "order_date", label: "Order date" }, { key: "items", label: "Items / products" },
    { key: "total", label: "Order total" }, { key: "payment_status", label: "Payment status" },
    { key: "order_status", label: "Order status" },
  ],
};
const metricOrder: Record<string, string[]> = {
  DAILY_SALES: ["total_sales", "cash", "card", "eft", "card_eft_unclassified", "invoice_credit_sales", "credit_sales", "refunds", "discounts", "transactions"],
  CASH_UP: ["expected_cash", "actual_cash", "variance", "cash", "card", "eft", "card_eft_unclassified", "refunds"],
  ONLINE_ORDERS: ["total_orders", "order_value", "online_sales", "paid_orders", "paid_value", "unpaid_orders", "unpaid_value", "completed_orders", "completed_value", "pending_orders", "pending_value", "cancelled_orders", "cancelled_value", "deliveries", "collections", "delivery_fees", "discounts", "refund_count", "refunds", "average_order_value", "new_customers", "returning_customers"],
  BUSINESS_PERFORMANCE: ["sales", "returns", "net_sales", "cost_of_goods", "gross_profit", "recorded_supplier_purchases", "orders", "refunds", "estimated_cost_movements"],
};
const friendly = (key: string) => key.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
function valueText(key: string, value: unknown, currency: string): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return Object.entries(value as Record<string, unknown>).map(([k, v]) => `${friendly(k)}: ${v}`).join(" · ");
  if (typeof value === "number" && /amount|sales|value|cash|paid|outstanding|total|refund|return|discount|variance|profit|cost|purchase|fee|debit|credit/i.test(key))
    return `${currency} ${new Intl.NumberFormat("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;
  return String(value).replaceAll("−", "-").replaceAll("×", "x");
}
export function notificationDocumentSections(job: NotificationJob): DocumentSection[] {
  const p = job.payload;
  const metrics = p.metrics ?? {};
  const ordered = metricOrder[p.kind] ?? Object.keys(metrics);
  const previousPeriod = metrics.previous_period && typeof metrics.previous_period === "object"
    ? metrics.previous_period as Record<string, unknown>
    : undefined;
  const comparisonKeys = ["sales", "returns", "net_sales", "cost_of_goods", "gross_profit"];
  const metricRows = ordered.filter((key) => key in metrics && !(p.kind === "BUSINESS_PERFORMANCE" && previousPeriod && comparisonKeys.includes(key))).flatMap((key) => {
    const title = metricLabels[key] ?? friendly(key);
    const value = metrics[key];
    if (value && typeof value === "object" && !Array.isArray(value))
      return Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => ({
        measure: `${title} — ${metricLabels[childKey] ?? friendly(childKey)}`,
        value: valueText(childKey, childValue, p.currency),
      }));
    return [{ measure: title, value: valueText(key, value, p.currency) }];
  });
  const sections: DocumentSection[] = [];
  if (metricRows.length) sections.push({ title: p.kind === "ONLINE_ORDERS" ? "Online order summary" : "Summary", columns: [{ key: "measure", label: "Measure" }, { key: "value", label: "Value" }], rows: metricRows });
  if (p.kind === "BUSINESS_PERFORMANCE" && previousPeriod) {
    const rows = comparisonKeys.filter((key) => key in metrics || key in previousPeriod).map((key) => {
      const current = metrics[key];
      const previous = previousPeriod[key];
      const difference = typeof current === "number" && typeof previous === "number" ? current - previous : undefined;
      return {
        metric: metricLabels[key] ?? friendly(key),
        current: valueText(key, current, p.currency),
        previous: valueText(key, previous, p.currency),
        difference: valueText(key, difference, p.currency),
      };
    });
    if (rows.length) sections.push({ title: "Current vs previous period", columns: [{ key: "metric", label: "Metric" }, { key: "current", label: "Current period" }, { key: "previous", label: "Previous period" }, { key: "difference", label: "Difference" }], rows });
  }
  if (p.statuses?.length) sections.push({ title: "Order status summary", columns: [{ key: "status", label: "Order status" }, { key: "count", label: "Orders" }, { key: "value", label: `Order value (${p.currency})` }], rows: p.statuses.map((row) => ({ ...row, status: friendly(String(row.status ?? "")), value: valueText("value", row.value, p.currency) })) });
  if (p.products?.length) sections.push({ title: "Top 5 online-selling products", columns: [{ key: "product", label: "Product" }, { key: "quantity", label: "Sales quantity" }, { key: "value", label: `Sales value (${p.currency})` }], rows: p.products.slice(0, 5).map((row) => ({ ...row, value: valueText("value", row.value, p.currency) })) });
  if (p.rows?.length) {
    const columns = detailColumns[p.kind]?.filter((column) => p.rows!.some((row) => column.key in row))
      ?? Object.keys(p.rows[0]).map((key) => ({ key, label: friendly(key) }));
    const rows = p.rows.map((row) => Object.fromEntries(columns.map((column) => [column.key, valueText(column.key, row[column.key], p.currency)])));
    if (p.kind === "MOVING_PRODUCTS") {
      const groups = [...new Set(rows.map((row) => row.category))];
      for (const group of groups) sections.push({ title: String(group), columns: columns.filter((column) => column.key !== "category"), rows: rows.filter((row) => row.category === group) });
    } else sections.push({ title: p.kind === "ONLINE_ORDERS" ? "Online orders" : "Report details", columns, rows });
  }
  if (!sections.length && p.count !== undefined) sections.push({ title: "Summary", columns: [{ key: "measure", label: "Measure" }, { key: "value", label: "Value" }], rows: [{ measure: "Records", value: p.count }] });
  return sections;
}
const metricLabels: Record<string, string> = {
  card_eft_unclassified: "Combined invoice Card/EFT (method not separated)",
  recorded_cash_removals: "Recorded cash removals (not necessarily expenses)",
  invoice_credit_sales: "Credit invoice sales",
  gross_profit: "Gross profit before overhead",
  online_sales: "Sales — goods issued",
  order_value: "All order value including unpaid/cancelled",
  paid_value: "Payments confirmed before refunds",
  delivery_fees: "Delivery fees collected",
  refunds: "Refunds paid",
  invoiced: "Invoice charges",
  recorded_supplier_purchases:
    "Recorded supplier purchases (not operating expenses)",
};
export function notificationMessage(job: NotificationJob) {
  const p = job.payload;
  const label = p.name || notificationLabels[p.kind] || p.kind;
  const lines = [
    `${p.business} · ${p.store}`,
    label,
    `${p.from ?? ""} to ${p.to ?? ""}`,
    "",
  ];
  for (const [key, value] of Object.entries(p.metrics ?? {})) {
    const title = metricLabels[key] ?? key.replaceAll("_", " ");
    lines.push(
      `${title}: ${typeof value === "object" ? JSON.stringify(value) : (value ?? "—")}`,
    );
  }
  if (Number(p.metrics?.estimated_cost_movements) > 0)
    lines.push(
      "Historical entries without a cost snapshot use the current product cost. Treat this as an estimate.",
    );
  if (p.count !== undefined)
    lines.push(`${p.count} record${p.count === 1 ? "" : "s"}`);
  for (const row of p.rows ?? [])
    lines.push(
      Object.entries(row)
        .map(([key, value]) => `${key.replaceAll("_", " ")}: ${value ?? "—"}`)
        .join(" | "),
    );
  if (p.rows && (p.count ?? 0) > p.rows.length)
    lines.push(
      "Only the first 100 records are included. Open the app for all records.",
    );
  if (p.products?.length) {
    lines.push("", "Top 5 online-selling products (goods issued)");
    for (const row of p.products.slice(0, 5))
      lines.push(
        `${row.product}: ${row.quantity} units · ${row.value} ${p.currency}`,
      );
  }
  if (p.statuses?.length) {
    lines.push("", "Order status summary");
    for (const row of p.statuses)
      lines.push(
        `${row.status}: ${row.count} orders · ${row.value} ${p.currency}`,
      );
  }
  lines.push(
    "",
    p.notes ?? "",
    "Manage these emails in Settings → Scheduled Email Notifications.",
  );
  return { subject: `${p.store}: ${label}`, text: lines.join("\n") };
}
const escape = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
export function notificationHtml(job: NotificationJob) {
  const m = notificationMessage(job);
  const sections = notificationDocumentSections(job).map((section) => `<h3 style="margin:24px 0 8px;color:#182c4d">${escape(section.title)}</h3><table style="border-collapse:collapse;width:100%;font-size:14px"><thead><tr>${section.columns.map((column) => `<th style="background:#182c4d;color:#fff;padding:9px;text-align:left">${escape(column.label)}</th>`).join("")}</tr></thead><tbody>${section.rows.map((row) => `<tr>${section.columns.map((column) => `<td style="border-bottom:1px solid #d9e0e8;padding:8px;vertical-align:top">${escape(String(row[column.key] ?? "—"))}</td>`).join("")}</tr>`).join("")}</tbody></table>`).join("");
  const p = job.payload;
  const period = p.from && p.to ? `${p.from} to ${p.to}` : "";
  const notes = p.notes ? `<p style="color:#526276;font-size:12px">${escape(p.notes)}</p>` : "";
  const limit = p.rows && (p.count ?? 0) > p.rows.length ? `<p>Showing ${p.rows.length} of ${p.count} records. Open POS INVENTORY for the complete report.</p>` : "";
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#182c4d;padding:24px"><p style="font-size:12px;color:#526276">${escape(p.business)} · ${escape(p.store)} · ${escape(p.currency)}${period ? ` · ${escape(period)}` : ""}</p><h1>${escape(m.subject)}</h1>${sections}${limit}${notes}<p style="margin-top:24px;font-size:12px;color:#526276">Manage this email in Settings → Scheduled Email Notifications.</p></body></html>`;
}
type Result<T> = { data: T | null; error: { message: string } | null };
export type NotificationWorkerDependencies = {
  secret: string;
  authenticate?: (secret: string) => PromiseLike<Result<boolean>>;
  configured: boolean;
  claim: () => PromiseLike<Result<unknown>>;
  complete: (
    id: string,
    sent: boolean,
    provider?: string,
    error?: string,
  ) => PromiseLike<{ error: { message: string } | null }>;
  send: (
    job: NotificationJob,
    message: { subject: string; text: string },
  ) => Promise<{ id: string }>;
  pause?: () => Promise<void>;
};
export function notificationHandler(deps: NotificationWorkerDependencies) {
  return async (request: Request) => {
    if (request.method !== "POST")
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    if (!deps.configured || (!deps.authenticate && deps.secret.length < 32))
      return Response.json(
        { error: "Delivery configuration is incomplete" },
        { status: 503 },
      );
    const token = request.headers.get("x-notification-secret") ?? "";
    const valid = deps.authenticate
      ? await deps.authenticate(token)
      : { data: token === deps.secret, error: null };
    if (token.length < 32 || valid.error || !valid.data)
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    const claimed = await deps.claim();
    if (claimed.error)
      return Response.json(
        { error: "Could not claim due notifications" },
        { status: 500 },
      );
    let sent = 0,
      failed = 0;
    for (const job of (claimed.data ?? []) as NotificationJob[]) {
      try {
        const result = await deps.send(job, notificationMessage(job));
        const completed = await deps.complete(job.id, true, result.id);
        if (completed.error) failed++;
        else sent++;
      } catch (error) {
        failed++;
        await deps.complete(
          job.id,
          false,
          undefined,
          error instanceof Error ? error.message : "Delivery failed",
        );
      }
      await deps.pause?.();
    }
    return Response.json({ sent, failed }, { status: failed ? 502 : 200 });
  };
}
