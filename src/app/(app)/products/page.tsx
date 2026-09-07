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
import { ListFilter } from "@/components/shell/list-filter";
import { ImportLink } from "@/features/imports/import-link";
import { ExportButton } from "@/features/reports/export-button";

const PAGE_SIZE = 20;

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const session = await getSession("products");
  if (!session?.activeStore) redirect("/onboarding");
  const store = session.activeStore;
  const page = Math.max(1, Number(sp.page) || 1);
  const q = sp.q ?? "";
  const supabase = await createClient();

  let query = supabase
    .from("v_product_stock")
    .select("*", { count: "exact" })
    .eq("store_id", store.id);
  if (q) query = query.ilike("name", `%${q}%`);
  const status = ["ok", "low", "out", "reorder", "inactive"].includes(
    sp.status ?? "",
  )
    ? (sp.status! as "ok" | "low" | "out" | "reorder" | "inactive")
    : "all";
  if (status === "inactive") query = query.eq("is_active", false);
  else if (status !== "all")
    query = query.eq("is_active", true).eq("stock_status", status);
  const { data, count } = await query
    .order("is_active", { ascending: false })
    .order("name")
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  const rows = data ?? [];

  return (
    <>
      <PageHeader
        title="Products"
        crumbs={[{ label: "Catalog" }, { label: "Products" }]}
        actions={
          <>
            <ToolbarSearch placeholder="Search products…" />
            <AddProductButton />
            <ImportLink kind="products" />
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted">
          Export the {rows.length} products on this page. Filters apply to the
          export.
        </p>
        <ExportButton
          filename="products"
          rows={rows}
          columns={[
            { key: "id", label: "Product ID" },
            { key: "name", label: "Product" },
            { key: "unit", label: "Unit" },
            { key: "quantity", label: "Quantity" },
            { key: "cost_price", label: "Cost" },
            { key: "selling_price", label: "Selling" },
            { key: "stock_status", label: "Status" },
          ]}
        />
      </div>

      <div className="mb-4">
        <ListFilter
          label="Status"
          param="status"
          value={status}
          options={[
            { value: "all", label: "All products" },
            { value: "ok", label: "In stock" },
            { value: "low", label: "Low stock" },
            { value: "out", label: "Out of stock" },
            { value: "reorder", label: "Reorder point" },
            { value: "inactive", label: "Inactive" },
          ]}
        />
      </div>

      <div className="rounded-lg border border-border bg-surface">
        {rows.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title="No products yet"
            description="Add your first product, or register one while scanning in Goods In."
          />
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
                      <Link
                        href={`/products/${r.id}`}
                        className="hover:text-primary-hover"
                      >
                        {r.name}
                      </Link>
                      {!r.is_active ? (
                        <Badge variant="neutral" className="ml-2">
                          Inactive
                        </Badge>
                      ) : null}
                    </TD>
                    <TD className="text-muted">{r.category_name ?? "—"}</TD>
                    <TD className="text-right tabular-nums">
                      {qty(r.quantity)}
                    </TD>
                    <TD className="text-right tabular-nums text-muted-foreground">
                      {money(r.cost_price, store.currency)}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {money(r.selling_price, store.currency)}
                    </TD>
                    <TD>
                      {r.is_active ? (
                        <StockStatusBadge status={r.stock_status} />
                      ) : (
                        <Badge variant="neutral">—</Badge>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={count ?? 0}
              params={{ q, status }}
              basePath="/products"
            />
          </>
        )}
      </div>
    </>
  );
}
