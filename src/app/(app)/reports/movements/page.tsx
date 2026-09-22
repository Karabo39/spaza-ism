import { businessDayStart, businessDayAfter } from "@/lib/business-date";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { DateFilter } from "@/features/reports/date-filter";
import { ActivityExport } from "@/features/reports/paged-export";
import { type ActivityRow } from "@/features/reports/activity-data";
import { readCursor, dataPage } from "@/lib/data-pages";
import { CursorPagination } from "@/components/ui/cursor-pagination";

import { MOVEMENT_META } from "@/features/stock/movement-meta";
import { qty, dateTime } from "@/lib/format";
import { ArrowLeftRight } from "lucide-react";

export default async function MovementsReport({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; cursor?: string }>;
}) {
  const sp = await searchParams;
  const session = await getSession("reports");
  if (!session?.activeStore) redirect("/onboarding");
  const store = session.activeStore;
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("activity_page", {
    p_kind: "movements",
    p_scope: store.id,
    p_from: sp.from ? businessDayStart(sp.from) : null,
    p_to: sp.to ? businessDayAfter(sp.to) : null,
    p_after: readCursor(sp.cursor),
    p_limit: 50,
  });
  if (error) throw error;
  const { rows, next } = dataPage<ActivityRow>(data);

  const columns = [
    { key: "date", label: "Date" },
    { key: "product", label: "Product" },
    { key: "sku", label: "SKU" },
    { key: "stock_type", label: "Stock Type" },
    { key: "type", label: "Type" },
    { key: "change", label: "Change" },
    { key: "before", label: "Before" },
    { key: "after", label: "After" },
    { key: "reason", label: "Reason" },
  ];

  return (
    <>
      <PageHeader
        title="Stock Movements"
        crumbs={[
          { label: "Reports", href: "/reports" },
          { label: "Stock Movements" },
        ]}
        description="Append-only stock changes for the active location, with source references and balances."
        actions={
          <>
            <DateFilter />
            <ActivityExport
              kind="movements"
              scope={store.id}
              from={sp.from ? businessDayStart(sp.from) : undefined}
              to={sp.to ? businessDayAfter(sp.to) : undefined}
              columns={columns}
              filename="stock-movements"
            />
          </>
        }
      />
      <p className="mb-4 text-sm text-muted">
        {rows.length} records shown. Export includes all matching records.
      </p>
      <div className="rounded-lg border border-border bg-surface">
        {rows.length === 0 ? (
          <EmptyState
            icon={ArrowLeftRight}
            title="No movements in this range"
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Date</TH>
                <TH>Product</TH>
                <TH>Type</TH>
                <TH className="text-right">Change</TH>
                <TH className="text-right">Balance</TH>
                <TH>Reason</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((m) => {
                const meta = MOVEMENT_META[m.movement_type] ?? {
                  label: m.movement_type,
                  variant: "neutral" as const,
                };
                const pos = Number(m.quantity_delta) >= 0;
                return (
                  <TR key={m.id}>
                    <TD className="text-xs text-muted whitespace-nowrap">
                      {dateTime(m.created_at)}
                    </TD>
                    <TD className="font-medium">{m.products?.name ?? "—"}</TD>
                    <TD>
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                    </TD>
                    <TD
                      className={`text-right tabular-nums ${pos ? "text-success" : "text-danger"}`}
                    >
                      {pos ? "+" : ""}
                      {qty(m.quantity_delta)}
                    </TD>
                    <TD className="text-right tabular-nums text-muted-foreground">
                      {qty(m.quantity_after)}
                    </TD>
                    <TD className="text-xs text-muted max-w-[16rem] truncate">
                      {m.reason ?? "—"}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </div>
      <CursorPagination
        next={next}
        current={sp.cursor}
        count={rows.length}
        basePath="/reports/movements"
        params={sp}
      />
    </>
  );
}
