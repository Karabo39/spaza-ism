import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/misc";
import { StockStatusBadge } from "@/features/stock/status-badge";
import { qty } from "@/lib/format";
import { CheckCircle2 } from "lucide-react";
import { RestockListButton } from "@/features/low-stock/restock-list-button";
import { ExportButton } from "@/features/reports/export-button";
import { Pagination } from "@/components/ui/pagination";

export default async function LowStockPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Math.floor(Number(sp.page) || 1));
  const pageSize = 100;
  const session = await getSession("low_stock");
  if (!session?.activeStore) redirect("/onboarding");
  const store = session.activeStore;
  const supabase = await createClient();

  const { data, error, count } = await supabase
    .from("v_product_stock")
    .select("*", { count: "exact" })
    .eq("store_id", store.id)
    .eq("is_active", true)
    .in("stock_status", ["low", "out", "reorder"])
    .order("quantity")
    .order("id")
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw error;
  const rows = data ?? [];

  return (
    <>
      <PageHeader
        title="Low Stock"
        crumbs={[{ label: "Stock Control" }, { label: "Low Stock" }]}
        description="Products at or below their minimum or reorder level."
        actions={
          <>
            <ExportButton
              rows={rows}
              columns={[
                { key: "name", label: "Product" },
                { key: "supplier_name", label: "Supplier" },
                { key: "quantity", label: "Quantity" },
                { key: "stock_status", label: "Status" },
                { key: "suggested_reorder", label: "Suggested reorder" },
              ]}
              filename="low-stock"
            />
            {rows.length > 0 ? (
              <RestockListButton
                items={rows.map((r) => ({
                  name: r.name,
                  qty: Number(r.suggested_reorder) || 0,
                  supplier: r.supplier_name,
                }))}
              />
            ) : null}
          </>
        }
      />

      <p className="mb-4 text-sm text-muted">
        {rows.length} products on this page. Exports and the restock list cover
        this page.
      </p>
      <div className="rounded-lg border border-border bg-surface">
        {rows.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="Everything is well stocked"
            description="No products are below their minimum or reorder level right now."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Product</TH>
                <TH>Supplier</TH>
                <TH className="text-right">In stock</TH>
                <TH className="text-right">Min</TH>
                <TH className="text-right">Reorder at</TH>
                <TH className="text-right">Suggested order</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD className="font-medium">{r.name}</TD>
                  <TD className="text-muted">{r.supplier_name ?? "—"}</TD>
                  <TD className="text-right tabular-nums">{qty(r.quantity)}</TD>
                  <TD className="text-right tabular-nums text-muted">
                    {qty(r.min_stock_level)}
                  </TD>
                  <TD className="text-right tabular-nums text-muted">
                    {qty(r.reorder_level)}
                  </TD>
                  <TD className="text-right font-medium tabular-nums text-accent">
                    {qty(r.suggested_reorder)}
                  </TD>
                  <TD>
                    <StockStatusBadge status={r.stock_status} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>
      <Pagination
        page={page}
        pageSize={pageSize}
        total={count ?? 0}
        params={{}}
        basePath="/low-stock"
      />
    </>
  );
}
