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
import { ExpiryBatches } from "@/features/products/expiry-batches";
import type { ProductStock } from "@/lib/db/database.types";
import { BarcodeCopy } from "@/features/products/barcode-copy";

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession("products");
  if (!session?.activeStore) redirect("/onboarding");
  const store = session.activeStore;
  const supabase = await createClient();

  const { data: product } = await supabase
    .from("v_product_catalog")
    .select("*")
    .eq("id", id)
    .eq("store_id", store.id)
    .maybeSingle();
  if (!product) notFound();
  const p = product as ProductStock & {
    undated_quantity: number;
    sellable_quantity: number;
    nearest_expiry: string | null;
  };
  const { data: batches, error: batchError } = await supabase
    .from("stock_batches")
    .select("id,quantity,expiry_date")
    .eq("product_id", id)
    .eq("store_id", store.id)
    .gt("quantity", 0)
    .order("expiry_date");

  const [{ data: barcodes }, { data: movements }, { data: priceHistory }] =
    await Promise.all([
      supabase
        .from("product_barcodes")
        .select("barcode, is_active")
        .eq("product_id", id)
        .eq("is_active", true),
      supabase
        .from("stock_movements")
        .select("id, movement_type, quantity_delta, quantity_after, created_at")
        .eq("product_id", id)
        .order("created_at", { ascending: false })
        .limit(15),
      supabase
        .from("product_price_history")
        .select("id, old_selling, new_selling, old_cost, new_cost, created_at")
        .eq("product_id", id)
        .order("created_at", { ascending: false })
        .limit(8),
    ]);

  const margin = Number(p.selling_price) - Number(p.cost_price);

  return (
    <>
      <PageHeader
        title={p.name}
        crumbs={[{ label: "Products", href: "/products" }, { label: p.name }]}
        description={p.category_name ?? undefined}
        actions={<ProductEditDialog product={p} />}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted">In stock</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {qty(p.quantity)}{" "}
              <span className="text-sm text-muted">{p.unit}</span>
            </p>
            <div className="mt-1">
              {p.is_active ? (
                <StockStatusBadge status={p.stock_status} />
              ) : (
                <Badge variant="neutral">Inactive</Badge>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted">Selling price</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-primary-hover">
              {money(p.selling_price, store.currency)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted">Cost / margin</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {money(p.cost_price, store.currency)}
            </p>
            <p className="text-xs text-muted">
              Margin {money(margin, store.currency)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted">Stock value</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {money(p.stock_value, store.currency)}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">Barcodes:</span>
        {(barcodes ?? []).length === 0 ? (
          <span className="text-muted">None</span>
        ) : (
          (barcodes ?? []).map((b) => (
            <BarcodeCopy key={b.barcode} barcode={b.barcode} />
          ))
        )}
        <span className="ml-4 text-muted">
          Min {qty(p.min_stock_level)} · Reorder {qty(p.reorder_level)}
        </span>
      </div>

      {p.track_expiry && (
        <p className="mb-3 text-sm">
          Nearest expiry: {p.nearest_expiry ?? (p.quantity > 0 ? "Date required" : "No stock")} | Sellable
          stock: {qty(p.sellable_quantity)}
        </p>
      )}
      {batchError ? (
        <p role="alert">Could not load expiry batches. Refresh to try again.</p>
      ) : p.track_expiry ? (
        <ExpiryBatches
          key={`${p.id}:${p.undated_quantity}`}
          product={p.id}
          undated={p.undated_quantity}
          batches={batches ?? []}
        />
      ) : p.quantity > 0 ? (
        <details className="mb-5"><summary className="cursor-pointer py-3 text-sm font-medium">Set up expiry tracking (optional)</summary><ExpiryBatches key={`${p.id}:${p.undated_quantity}`} product={p.id} undated={p.undated_quantity} batches={batches ?? []} /></details>
      ) : null}
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface">
          <div className="border-b border-border px-5 py-3">
            <h3 className="text-sm font-semibold">Recent movements</h3>
          </div>
          {(movements ?? []).length === 0 ? (
            <EmptyState
              title="No movements yet"
              description="Stock changes appear here."
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Type</TH>
                  <TH className="text-right">Change</TH>
                  <TH className="text-right">Balance</TH>
                  <TH className="text-right">When</TH>
                </TR>
              </THead>
              <TBody>
                {(movements ?? []).map((m) => {
                  const meta = MOVEMENT_META[m.movement_type] ?? {
                    label: m.movement_type,
                    variant: "neutral" as const,
                  };
                  const pos = Number(m.quantity_delta) >= 0;
                  return (
                    <TR key={m.id}>
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
                      <TD className="text-right text-xs text-muted">
                        {dateTime(m.created_at)}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </div>

        <div className="rounded-lg border border-border bg-surface">
          <div className="border-b border-border px-5 py-3">
            <h3 className="text-sm font-semibold">Price history</h3>
          </div>
          {(priceHistory ?? []).length === 0 ? (
            <EmptyState
              title="No price changes"
              description="Price changes are recorded automatically."
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>When</TH>
                  <TH className="text-right">Cost</TH>
                  <TH className="text-right">Selling</TH>
                </TR>
              </THead>
              <TBody>
                {(priceHistory ?? []).map((h) => (
                  <TR key={h.id}>
                    <TD className="text-xs text-muted">
                      {dateTime(h.created_at)}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {h.old_cost === null
                        ? "—"
                        : money(h.old_cost, store.currency)}{" "}
                      →{" "}
                      {h.new_cost === null
                        ? "—"
                        : money(h.new_cost, store.currency)}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {h.old_selling === null
                        ? "—"
                        : money(h.old_selling, store.currency)}{" "}
                      →{" "}
                      {h.new_selling === null
                        ? "—"
                        : money(h.new_selling, store.currency)}
                    </TD>
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
