import {StoreProvider} from "@/lib/store-context";
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
import { MOVEMENT_META } from "@/features/stock/movement-meta";
import { qty, dateTime } from "@/lib/format";
import { ArrowLeftRight } from "lucide-react";

export default async function MovementsReport({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; warehouse?: string }>;
}) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session?.activeStore) redirect("/onboarding");
  const warehouses = session.stores.filter(
    (s) =>
      s.locationType === "warehouse" &&
      s.modules.warehouse &&
      s.modules.reports &&
      s.businessId === session.activeStore!.businessId,
  );
  const store =
    warehouses.find((s) => s.id === sp.warehouse) ||
    (sp.warehouse ? undefined : warehouses[0]);
  if (!store) redirect("/no-access");
  const supabase = await createClient();

  let query = supabase
    .from("stock_movements")
    .select(
      "id, movement_type, quantity_delta, quantity_before, quantity_after, reason, created_at, products(name,sku)",
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
    movement_type: keyof typeof MOVEMENT_META;
    quantity_delta: number;
    quantity_before: number;
    quantity_after: number;
    reason: string | null;
    created_at: string;
    products: { name: string; sku: string | null } | null;
  }[];

  const exportRows = rows.map((m) => ({
    date: dateTime(m.created_at),
    product: m.products?.name ?? "",
    sku: m.products?.sku ?? "",
    type: MOVEMENT_META[m.movement_type]?.label ?? m.movement_type,
    change: m.quantity_delta,
    before: m.quantity_before,
    after: m.quantity_after,
    reason: m.reason ?? "",
  }));
  const columns = [
    { key: "date", label: "Date" },
    { key: "product", label: "Product" },
    { key: "sku", label: "SKU" },
    { key: "type", label: "Type" },
    { key: "change", label: "Change" },
    { key: "before", label: "Before" },
    { key: "after", label: "After" },
    { key: "reason", label: "Reason" },
  ];

  return (
    <StoreProvider session={{...session,activeStore:store}}>
      <PageHeader
        title="Warehouse Stock Movements"
        crumbs={[
          { label: "Reports", href: "/reports" },
          { label: "Warehouse Stock Movements" },
        ]}
        description="Append-only stock changes for the active location, with source references and balances."
        actions={
          <>
            <DateFilter />
            <ExportButton
              rows={exportRows}
              columns={columns}
              filename="warehouse-stock-movements"
            />
          </>
        }
      />
      <form className="mb-4 flex gap-2" action="/reports/warehouse-movements">
        <label>
          Warehouse{" "}
          <select
            name="warehouse"
            defaultValue={store.id}
            className="rounded border border-border bg-input p-2"
          >
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        <button className="rounded bg-primary px-3 text-white" type="submit">
          View warehouse report
        </button>
      </form>
      <p className="mb-4 text-sm text-muted">
        {rows.length} records shown. Exports and totals cover these results.
        {rows.length === 500
          ? " Latest 500; narrow the dates for earlier records."
          : ""}
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
    </StoreProvider>
  );
}
