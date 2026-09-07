import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { ListFilter } from "@/components/shell/list-filter";
import { DateFilter } from "@/features/reports/date-filter";
import { ReportTable } from "@/features/reports/report-table";
import { ExportButton } from "@/features/reports/export-button";
import { dateTime } from "@/lib/format";
import { businessDayStart, businessDayAfter } from "@/lib/business-date";
export default async function StockTakeReport({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; status?: string }>;
}) {
  const sp = await searchParams,
    session = await getSession("reports");
  if (!session?.activeStore) redirect("/onboarding");
  const db = await createClient();
  let query = db
    .from("v_stock_take_variance")
    .select("*")
    .eq("store_id", session.activeStore.id);
  if (sp.from) query = query.gte("created_at", businessDayStart(sp.from));
  if (sp.to) query = query.lt("created_at", businessDayAfter(sp.to));
  if (sp.status) query = query.eq("status", sp.status);
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("product_name")
    .limit(1000);
  if (error) throw error;
  const rows = (data ?? []).map((r) => ({
    ...r,
    date: dateTime(r.created_at),
    system_qty: Number(r.system_qty),
    counted_qty: r.counted_qty === null ? "Pending" : Number(r.counted_qty),
    variance: r.variance === null ? "" : Number(r.variance),
    counted_at: dateTime(r.counted_at),
  }));
  const columns = [
    { key: "stock_take_id", label: "Stock take" },
    { key: "date", label: "Started" },
    { key: "status", label: "Status" },
    { key: "product_name", label: "Product" },
    { key: "system_qty", label: "System at count" },
    { key: "counted_qty", label: "Physical count" },
    { key: "variance", label: "Variance" },
    { key: "counted_at", label: "Count saved" },
  ];
  return (
    <>
      <PageHeader
        title="Stock-take Variance"
        description="Physical counts compared with the recorded quantity at count time. Only completed stock takes have posted adjustments."
        crumbs={[
          { label: "Reports", href: "/reports" },
          { label: "Stock takes" },
        ]}
        actions={
          <>
            <DateFilter />
            <ListFilter
              label="Status"
              param="status"
              value={sp.status ?? ""}
              options={[
                { value: "", label: "All statuses" },
                { value: "IN_PROGRESS", label: "In progress" },
                { value: "COMPLETED", label: "Completed" },
                { value: "CANCELLED", label: "Cancelled" },
              ]}
            />
            <ExportButton
              rows={rows}
              columns={columns}
              filename="stock-take-variance"
            />
          </>
        }
      />
      {rows.length === 1000 && (
        <p className="mb-3 text-warning">
          Latest 1,000 product counts. Narrow the date range for a complete
          export.
        </p>
      )}
      <ReportTable rows={rows} columns={columns} />
    </>
  );
}
