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
export default async function ReturnsReport({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; status?: string }>;
}) {
  const sp = await searchParams,
    session = await getSession("reports");
  if (!session?.activeStore) redirect("/onboarding");
  const db = await createClient();
  let query = db
    .from("v_return_report")
    .select("*")
    .eq("store_id", session.activeStore.id);
  if (sp.from) query = query.gte("created_at", businessDayStart(sp.from));
  if (sp.to) query = query.lt("created_at", businessDayAfter(sp.to));
  if (sp.status) query = query.eq("status", sp.status);
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw error;
  const rows = (data ?? []).map((r) => ({
    ...r,
    date: dateTime(r.created_at),
    amount: Number(r.amount),
    refunded: Number(r.refunded),
    allocated_credit: Number(r.allocated_credit),
  }));
  const columns = [
    { key: "reference", label: "Return" },
    { key: "date", label: "Date" },
    { key: "status", label: "Status" },
    { key: "items", label: "Returned items" },
    { key: "inventory_actions", label: "Inventory action" },
    { key: "reason", label: "Reason" },
    { key: "amount", label: "Return credit" },
    { key: "refunded", label: "Refund paid" },
    { key: "allocated_credit", label: "Credit used on another invoice" },
  ];
  return (
    <>
      <PageHeader
        title="Returned Stock"
        description="Returned products, inspection decisions, return credit, refunds paid and credit allocated to other invoices."
        crumbs={[{ label: "Reports", href: "/reports" }, { label: "Returns" }]}
        actions={
          <>
            <DateFilter />
            <ListFilter
              label="Status"
              param="status"
              value={sp.status ?? ""}
              options={[
                { value: "", label: "All statuses" },
                { value: "SUBMITTED", label: "Awaiting approval" },
                { value: "APPROVED", label: "Approved" },
                { value: "REJECTED", label: "Rejected" },
              ]}
            />
            <ExportButton
              rows={rows}
              columns={columns}
              filename="returned-stock"
            />
          </>
        }
      />
      {rows.length === 1000 && (
        <p className="mb-3 text-warning">
          Latest 1,000 returns. Narrow the date range for a complete export.
        </p>
      )}
      <ReportTable rows={rows} columns={columns} />
    </>
  );
}
