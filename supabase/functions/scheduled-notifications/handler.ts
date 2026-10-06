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
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#182c4d;padding:24px"><h1>${escape(job.payload.business)}</h1><h2>${escape(m.subject)}</h2><p>Store: ${escape(job.payload.store)} · Currency: ${escape(job.payload.currency)}</p><div style="line-height:1.6">${m.text.split("\n").map(escape).join("<br>")}</div></body></html>`;
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
