import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { ToolbarSearch } from "@/components/shell/toolbar-search";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import { StockStatusBadge } from "@/features/stock/status-badge";
import { AddProductButton } from "@/features/products/add-product-button";
import { money, qty } from "@/lib/format";
import { Boxes } from "lucide-react";

const PAGE_SIZE = 20;

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session?.activeStore) redirect("/onboarding");
  const store = session.activeStore;
  const page = Math.max(1, Number(sp.page) || 1);
  const q = sp.q ?? "";
  const supabase = await createClient();

  let query = supabase.from("v_product_stock").select("*", { count: "exact" }).eq("store_id", store.id);
  if (q) query = query.ilike("name", `%${q}%`);
  const { data, count } = await query.order("is_active", { ascending: false }).order("name").range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  const rows = data ?? [];

  return (
    <>
      <PageHeader title="Products" crumbs={[{ label: "Catalog" }, { label: "Products" }]}
        actions={<><ToolbarSearch placeholder="Search products…" /><AddProductButton /></>} />

      <div className="rounded-lg border border-border bg-surface">
        {rows.length === 0 ? (
          <EmptyState icon={Boxes} title="No products yet"
            description="Add your first product, or register one while scanning in Goods In." />
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH>Product</TH>
                  <TH>Category</TH>
                  <TH className="text-right">Stock</TH>
                  <TH className="text-right">Cost</TH>
                  <TH className="text-right">Selling</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={r.id}>
                    <TD className="font-medium">
                      <Link href={`/products/${r.id}`} className="hover:text-primary-hover">{r.name}</Link>
                      {!r.is_active ? <Badge variant="neutral" className="ml-2">Inactive</Badge> : null}
                    </TD>
                    <TD className="text-muted">{r.category_name ?? "—"}</TD>
                    <TD className="text-right tabular-nums">{qty(r.quantity)}</TD>
                    <TD className="text-right tabular-nums text-muted-foreground">{money(r.cost_price, store.currency)}</TD>
                    <TD className="text-right tabular-nums">{money(r.selling_price, store.currency)}</TD>
                    <TD>{r.is_active ? <StockStatusBadge status={r.stock_status} /> : <Badge variant="neutral">—</Badge>}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} params={{ q }} basePath="/products" />
          </>
        )}
      </div>
    </>
  );
}
