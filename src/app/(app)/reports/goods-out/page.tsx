import { businessDayStart, businessDayAfter } from "@/lib/business-date";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { DateFilter } from "@/features/reports/date-filter";
import { ActivityExport } from "@/features/reports/paged-export";
import {
  type ActivityRow,
  paymentType,
  paymentAmount,
  approverName as approver,
} from "@/features/reports/activity-data";
import { readCursor, dataPage } from "@/lib/data-pages";
import { CursorPagination } from "@/components/ui/cursor-pagination";

import { money, dateTime } from "@/lib/format";
import { PackageMinus } from "lucide-react";

export default async function GoodsOutReport({
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
    p_kind: "sales",
    p_scope: store.id,
    p_from: sp.from ? businessDayStart(sp.from) : null,
    p_to: sp.to ? businessDayAfter(sp.to) : null,
    p_after: readCursor(sp.cursor),
    p_limit: 50,
  });
  if (error) throw error;
  const { rows, next } = dataPage<ActivityRow>(data);
  const salesperson = (r: ActivityRow) => r.cashier;
  const cash = rows.reduce(
    (sum, r) => sum + paymentAmount(r, ["CASH"], "CASH"),
    0,
  );
  const credit = rows
    .filter((r) => r.sale_type === "CREDIT")
    .reduce((s, r) => s + Number(r.total_amount), 0);
  const card = rows.reduce(
    (sum, r) => sum + paymentAmount(r, ["CARD", "EFT"], "CARD_EFT"),
    0,
  );

  const columns = [
    { key: "date", label: "Date" },
    { key: "type", label: "Type" },
    { key: "customer", label: "Customer" },
    { key: "items", label: "Items" },
    { key: "total", label: "Total" },
    { key: "override", label: "Override" },
    { key: "salesperson", label: "Sold by" },
    { key: "approved_by", label: "Override approved by" },
  ];

  return (
    <>
      <PageHeader
        title="Goods Out"
        crumbs={[
          { label: "Reports", href: "/reports" },
          { label: "Goods Out" },
        ]}
        description="Checkout sales by payment type and customer; invoice transactions appear in Payment Report."
        actions={
          <>
            <DateFilter />
            <ActivityExport
              kind="sales"
              scope={store.id}
              from={sp.from ? businessDayStart(sp.from) : undefined}
              to={sp.to ? businessDayAfter(sp.to) : undefined}
              columns={columns}
              filename="goods-out"
            />
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted">Cash sales</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-accent">
              {money(cash, store.currency)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted">Credit sales</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-primary-hover">
              {money(credit, store.currency)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted">Card/EFT sales</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {money(card, store.currency)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted">Total</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {money(cash + credit + card, store.currency)}
            </p>
          </CardContent>
        </Card>
      </div>
      <p className="mb-4 text-sm text-muted">
        {rows.length} records shown. Totals above cover this page. Export
        includes all matching records.
      </p>
      <div className="rounded-lg border border-border bg-surface">
        {rows.length === 0 ? (
          <EmptyState icon={PackageMinus} title="No sales in this range" />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Date</TH>
                <TH>Type</TH>
                <TH>Customer</TH>
                <TH>Sold by</TH>
                <TH>Override approved by</TH>
                <TH className="text-right">Items</TH>
                <TH className="text-right">Total</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD className="text-xs text-muted whitespace-nowrap">
                    {dateTime(r.created_at)}
                  </TD>
                  <TD>
                    <Badge
                      variant={r.sale_type === "CASH" ? "accent" : "primary"}
                    >
                      {paymentType(r)}
                    </Badge>
                    {r.credit_override ? (
                      <Badge variant="danger" className="ml-1">
                        Override
                      </Badge>
                    ) : null}
                  </TD>
                  <TD className="text-muted">{r.customer_name ?? "—"}</TD>
                  <TD>{salesperson(r)}</TD>
                  <TD>{approver(r)}</TD>
                  <TD className="text-right tabular-nums">
                    {r.items_count ?? 0}
                  </TD>
                  <TD className="text-right tabular-nums font-medium">
                    {money(r.total_amount, store.currency)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>
      <CursorPagination
        next={next}
        current={sp.cursor}
        count={rows.length}
        basePath="/reports/goods-out"
        params={sp}
      />
    </>
  );
}
