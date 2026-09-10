import { businessDayStart, businessDayAfter } from "@/lib/business-date";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { ToolbarSearch } from "@/components/shell/toolbar-search";
import { DateFilter } from "@/features/reports/date-filter";
import { ExportButton } from "@/features/reports/export-button";
import { ReportTable } from "@/features/reports/report-table";
import { dateTime } from "@/lib/format";
export default async function PriceHistory({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const session = await getSession("reports");
  if (!session?.activeStore) redirect("/onboarding");
  const db = await createClient();
  let query = db
    .from("product_price_history")
    .select("*")
    .eq("store_id", session.activeStore.id);
  if (sp.q) query = query.ilike("product_name", `%${sp.q}%`);
  if (sp.from) query = query.gte("created_at", businessDayStart(sp.from));
  if (sp.to) query = query.lt("created_at", businessDayAfter(sp.to));
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw error;
  const ids=[...new Set((data??[]).flatMap(r=>r.performed_by?[r.performed_by]:[]))];
  const people=ids.length?await db.from("profiles").select("id,full_name").in("id",ids):{data:[],error:null};if(people.error)throw people.error;
  const rows = (data ?? []).map((r) => ({
    ...r,
    date: dateTime(r.created_at),
    changed_by: people.data?.find(p=>p.id===r.performed_by)?.full_name ?? (r.performed_by?"User unavailable":"Not recorded"),
  }));
  const columns = [
    { key: "product_name", label: "Product" },
    { key: "old_cost", label: "Previous cost" },
    { key: "new_cost", label: "New cost" },
    { key: "old_selling", label: "Previous price" },
    { key: "new_selling", label: "New price" },
    { key: "date", label: "Date" },
    {key:"changed_by",label:"Changed by"},
    { key: "reason", label: "Event" },
  ];
  return (
    <>
      <PageHeader
        title="Price History"
        description="Cost and selling-price changes, including preserved historical records and opening snapshots."
        crumbs={[
          { label: "Reports", href: "/reports" },
          { label: "Price History" },
        ]}
        actions={
          <>
            <ToolbarSearch placeholder="Product name…" />
            <DateFilter />
            <ExportButton
              rows={rows}
              columns={columns}
              filename="price-history"
            />
          </>
        }
      />
      {rows.length === 1000 && (
        <p className="text-warning">
          Latest 1,000 changes; narrow the filters for a complete report.
        </p>
      )}
      <ReportTable rows={rows} columns={columns} />
    </>
  );
}
