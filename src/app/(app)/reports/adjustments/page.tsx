import { businessDayStart, businessDayAfter } from "@/lib/business-date";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { DateFilter } from "@/features/reports/date-filter";
import { ExportButton } from "@/features/reports/export-button";
import { REASON_LABELS } from "@/features/stock/movement-meta";
import { qty, dateTime } from "@/lib/format";
import { SlidersHorizontal } from "lucide-react";

export default async function AdjustmentsReport({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session?.activeStore) redirect("/onboarding");
  const store = session.activeStore;
  const supabase = await createClient();

  let query = supabase
    .from("stock_adjustments")
    .select(
      "id, reason, quantity_before, quantity_after, delta, note, created_at, products(name)",
    )
    .eq("store_id", store.id);
  if (sp.from) query = query.gte("created_at", businessDayStart(sp.from));
  if (sp.to) query = query.lt("created_at", businessDayAfter(sp.to));
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  const rows = (data ?? []) as unknown as {
    id: string;
    reason: string;
    quantity_before: number;
    quantity_after: number;
    delta: number;
    note: string | null;
    created_at: string;
    products: { name: string } | null;
  }[];

  const exportRows = rows.map((r) => ({
    date: dateTime(r.created_at),
    product: r.products?.name ?? "",
    reason: REASON_LABELS[r.reason] ?? r.reason,
    before: r.quantity_before,
    after: r.quantity_after,
    change: r.delta,
    note: r.note ?? "",
  }));
  const columns = [
    { key: "date", label: "Date" },
    { key: "product", label: "Product" },
    { key: "reason", label: "Reason" },
    { key: "before", label: "Before" },
    { key: "after", label: "After" },
    { key: "change", label: "Change" },
    { key: "note", label: "Note" },
  ];

  return (
    <>
      <PageHeader
        title="Stock Adjustments"
        crumbs={[
          { label: "Reports", href: "/reports" },
          { label: "Adjustments" },
        ]}
        description="Stock corrections, damage and losses with reasons and quantity changes."
        actions={
          <>
            <DateFilter />
            <ExportButton
              rows={exportRows}
              columns={columns}
              filename="adjustments"
            />
          </>
        }
      />
      <p className="mb-4 text-sm text-muted">
        {rows.length} records shown. Exports and totals cover these results.
        {rows.length === 500
          ? " Latest 500; narrow the dates for earlier records."
          : ""}
      </p>
      <div className="rounded-lg border border-border bg-surface">
        {rows.length === 0 ? (
          <EmptyState
            icon={SlidersHorizontal}
            title="No adjustments in this range"
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Date</TH>
                <TH>Product</TH>
                <TH>Reason</TH>
                <TH className="text-right">Before</TH>
                <TH className="text-right">After</TH>
                <TH className="text-right">Change</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD className="text-xs text-muted whitespace-nowrap">
                    {dateTime(r.created_at)}
                  </TD>
                  <TD className="font-medium">{r.products?.name ?? "—"}</TD>
                  <TD>
                    <Badge variant="neutral">
                      {REASON_LABELS[r.reason] ?? r.reason}
                    </Badge>
                  </TD>
                  <TD className="text-right tabular-nums text-muted-foreground">
                    {qty(r.quantity_before)}
                  </TD>
                  <TD className="text-right tabular-nums">
                    {qty(r.quantity_after)}
                  </TD>
                  <TD
                    className={`text-right tabular-nums ${Number(r.delta) >= 0 ? "text-success" : "text-danger"}`}
                  >
                    {Number(r.delta) >= 0 ? "+" : ""}
                    {qty(r.delta)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </>
  );
}
