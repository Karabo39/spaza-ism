import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { StockStatusBadge } from "@/features/stock/status-badge";
import { ProductEditDialog } from "@/features/products/product-edit-dialog";
import { MOVEMENT_META } from "@/features/stock/movement-meta";
import { money, qty, dateTime } from "@/lib/format";
import type { ProductStock } from "@/lib/db/database.types";

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session?.activeStore) redirect("/onboarding");
  const store = session.activeStore;
  const supabase = await createClient();

  const { data: product } = await supabase.from("v_product_stock").select("*").eq("id", id).maybeSingle();
  if (!product) notFound();
  const p = product as ProductStock;

  const [{ data: barcodes }, { data: movements }, { data: priceHistory }] = await Promise.all([
    supabase.from("product_barcodes").select("barcode, is_active").eq("product_id", id).eq("is_active", true),
    supabase.from("stock_movements").select("id, movement_type, quantity_delta, quantity_after, created_at").eq("product_id", id).order("created_at", { ascending: false }).limit(15),
    supabase.from("price_history").select("id, old_selling, new_selling, old_cost, new_cost, changed_at").eq("product_id", id).order("changed_at", { ascending: false }).limit(8),
  ]);

  const margin = Number(p.selling_price) - Number(p.cost_price);

  return (
    <>
      <PageHeader title={p.name} crumbs={[{ label: "Products", href: "/products" }, { label: p.name }]}
        description={p.category_name ?? undefined}
        actions={<ProductEditDialog product={p} />} />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card><CardContent className="p-4"><p className="text-xs text-muted">In stock</p><p className="mt-1 text-xl font-semibold tabular-nums">{qty(p.quantity)} <span className="text-sm text-muted">{p.unit}</span></p><div className="mt-1">{p.is_active ? <StockStatusBadge status={p.stock_status} /> : <Badge variant="neutral">Inactive</Badge>}</div></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted">Selling price</p><p className="mt-1 text-xl font-semibold tabular-nums text-primary-hover">{money(p.selling_price, store.currency)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted">Cost / margin</p><p className="mt-1 text-xl font-semibold tabular-nums">{money(p.cost_price, store.currency)}</p><p className="text-xs text-muted">Margin {money(margin, store.currency)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted">Stock value</p><p className="mt-1 text-xl font-semibold tabular-nums">{money(p.stock_value, store.currency)}</p></CardContent></Card>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">Barcodes:</span>
        {(barcodes ?? []).length === 0 ? <span className="text-muted">None</span> :
          (barcodes ?? []).map((b) => <Badge key={b.barcode} variant="neutral">{b.barcode}</Badge>)}
        <span className="ml-4 text-muted">Min {qty(p.min_stock_level)} · Reorder {qty(p.reorder_level)}</span>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface">
          <div className="border-b border-border px-5 py-3"><h3 className="text-sm font-semibold">Recent movements</h3></div>
          {(movements ?? []).length === 0 ? (
            <EmptyState title="No movements yet" description="Stock changes appear here." />
          ) : (
            <Table>
              <THead><TR><TH>Type</TH><TH className="text-right">Change</TH><TH className="text-right">Balance</TH><TH className="text-right">When</TH></TR></THead>
              <TBody>
                {(movements ?? []).map((m) => {
                  const meta = MOVEMENT_META[m.movement_type] ?? { label: m.movement_type, variant: "neutral" as const };
                  const pos = Number(m.quantity_delta) >= 0;
                  return (
                    <TR key={m.id}>
                      <TD><Badge variant={meta.variant}>{meta.label}</Badge></TD>
                      <TD className={`text-right tabular-nums ${pos ? "text-success" : "text-danger"}`}>{pos ? "+" : ""}{qty(m.quantity_delta)}</TD>
                      <TD className="text-right tabular-nums text-muted-foreground">{qty(m.quantity_after)}</TD>
                      <TD className="text-right text-xs text-muted">{dateTime(m.created_at)}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </div>

        <div className="rounded-lg border border-border bg-surface">
          <div className="border-b border-border px-5 py-3"><h3 className="text-sm font-semibold">Price history</h3></div>
          {(priceHistory ?? []).length === 0 ? (
            <EmptyState title="No price changes" description="Price changes are recorded automatically." />
          ) : (
            <Table>
              <THead><TR><TH>When</TH><TH className="text-right">Cost</TH><TH className="text-right">Selling</TH></TR></THead>
              <TBody>
                {(priceHistory ?? []).map((h) => (
                  <TR key={h.id}>
                    <TD className="text-xs text-muted">{dateTime(h.changed_at)}</TD>
                    <TD className="text-right tabular-nums">{money(h.old_cost ?? 0, store.currency)} → {money(h.new_cost ?? 0, store.currency)}</TD>
                    <TD className="text-right tabular-nums">{money(h.old_selling ?? 0, store.currency)} → {money(h.new_selling ?? 0, store.currency)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </div>
      </div>
    </>
  );
}
