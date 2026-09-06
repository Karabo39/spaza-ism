import { businessDate } from "@/lib/business-date";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { DateFilter } from "@/features/reports/date-filter";
import { ExportButton } from "@/features/reports/export-button";
import { money } from "@/lib/format";
export default async function ProfitReport({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session?.activeStore) redirect("/onboarding");
  const store = session.activeStore;
  if (store.role === "employee") redirect("/reports");
  const to = sp.to ?? businessDate();
  const start = new Date(`${to}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 6);
  const from = sp.from ?? start.toISOString().slice(0, 10);
  const db = await createClient();
  const { data, error } = await db.rpc("profit_summary", {
    p_store: store.id,
    p_from: from,
    p_to: to,
  });
  if (error) throw error;
  const v = data as Record<string, number>;
  const labels: Record<string, string> = {
    sales: "Sales",
    returns: "Returns",
    net_sales: "Net sales",
    cost_of_goods: "Cost of goods",
    gross_profit: "Gross profit before overhead",
  };
  const rows = Object.entries(labels).map(([key, label]) => ({
    label,
    amount: Number(v[key] ?? 0),
  }));
  return (
    <>
      <PageHeader
        title="Gross Profit"
        description={`Sales less returns and stock cost, before overhead. ${from} to ${to}. Invoice sales exclude configured tax.`}
        crumbs={[{ label: "Reports", href: "/reports" }, { label: "Profit" }]}
        actions={
          <>
            <DateFilter />
            <ExportButton
              rows={rows}
              columns={[
                { key: "label", label: "Measure" },
                { key: "amount", label: "Amount" },
              ]}
              filename="gross-profit"
            />
          </>
        }
      />
      <div className="grid gap-3 sm:grid-cols-3">
        {rows.map((r) => (
          <div
            key={r.label}
            className="rounded-lg border border-border bg-surface p-4"
          >
            <p className="text-sm text-muted">{r.label}</p>
            <p className="text-xl font-semibold">
              {money(r.amount, store.currency)}
            </p>
          </div>
        ))}
      </div>
      {v.estimated_cost_movements > 0 && (
        <p className="mt-4 text-sm text-warning">
          {v.estimated_cost_movements} historical movements have no recorded
          cost. Their current product cost is used, so this report is an
          estimate.
        </p>
      )}
    </>
  );
}
