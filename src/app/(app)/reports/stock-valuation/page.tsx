import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/misc";
import { ExportButton } from "@/features/reports/export-button";
import { money, qty } from "@/lib/format";
import { Boxes } from "lucide-react";

export default async function StockValuationReport() {
  const session = await getSession();
  if (!session?.activeStore) redirect("/onboarding");
  const store = session.activeStore;
  const supabase = await createClient();

  const { data, count, error } = await supabase
    .from("v_product_stock")
    .select("*", { count: "exact" })
    .eq("store_id", store.id)
    .eq("is_active", true)
    .order("stock_value", { ascending: false })
    .limit(1000);
  if (error) throw error;
  const { data: summary, error: summaryError } = await supabase.rpc(
    "dashboard_summary",
    { p_store: store.id },
  );
  if (summaryError) throw summaryError;
  const totals = summary as { stock_value: number; retail_value: number };
  const rows = data ?? [];
  const totalCost = Number(totals.stock_value);
  const totalRetail = Number(totals.retail_value);

  const exportRows = rows.map((r) => ({
    name: r.name,
    category: r.category_name ?? "",
    quantity: Number(r.quantity),
    cost: Number(r.cost_price),
    selling: Number(r.selling_price),
    stock_value: Number(r.stock_value),
    retail_value: Number(r.retail_value),
  }));
  const columns = [
    { key: "name", label: "Product" },
    { key: "category", label: "Category" },
    { key: "quantity", label: "Quantity" },
    { key: "cost", label: "Cost" },
    { key: "selling", label: "Selling" },
    { key: "stock_value", label: "Stock value (cost)" },
    { key: "retail_value", label: "Retail value" },
  ];

  return (
    <>
      <PageHeader
        title="Stock Valuation"
        crumbs={[
          { label: "Reports", href: "/reports" },
          { label: "Stock Valuation" },
        ]}
        description="Current stock quantities valued at recorded cost and selling prices."
        actions={
          <ExportButton
            rows={exportRows}
            columns={columns}
            filename="stock-valuation"
          />
        }
      />
      {(count ?? 0) > rows.length && (
        <p className="mb-3 text-warning">
          Totals cover all {count} active products. The table and export show
          the 1,000 highest-value products.
        </p>
      )}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted">Value at cost</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {money(totalCost, store.currency)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted">Value at retail</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {money(totalRetail, store.currency)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted">Potential margin</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-success">
              {money(totalRetail - totalCost, store.currency)}
            </p>
          </CardContent>
        </Card>
      </div>
      <div className="rounded-lg border border-border bg-surface">
        {rows.length === 0 ? (
          <EmptyState icon={Boxes} title="No stock to value" />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Product</TH>
                <TH>Category</TH>
                <TH className="text-right">Qty</TH>
                <TH className="text-right">Cost</TH>
                <TH className="text-right">Value</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD className="font-medium">{r.name}</TD>
                  <TD className="text-muted">{r.category_name ?? "—"}</TD>
                  <TD className="text-right tabular-nums">{qty(r.quantity)}</TD>
                  <TD className="text-right tabular-nums text-muted-foreground">
                    {money(r.cost_price, store.currency)}
                  </TD>
                  <TD className="text-right tabular-nums font-medium">
                    {money(r.stock_value, store.currency)}
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
