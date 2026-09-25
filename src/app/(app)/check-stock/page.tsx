import { stockQuantity } from "@/lib/format";
import { StockExport } from "@/features/stock/stock-export";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { ToolbarSearch } from "@/components/shell/toolbar-search";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/misc";
import { CursorPagination } from "@/components/ui/cursor-pagination";
import { readCursor, dataPage, type CatalogProduct } from "@/lib/data-pages";
import { StockStatusBadge } from "@/features/stock/status-badge";
import { money } from "@/lib/format";
import { Boxes } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

const PAGE_SIZE = 20;
const FILTERS = [
  { key: "all", label: "All active" },
  { key: "ok", label: "In stock" },
  { key: "low", label: "Low" },
  { key: "out", label: "Out of stock" },
  { key: "reorder", label: "Reorder point" },
  { key: "inactive", label: "Inactive" },
];

export default async function CheckStockPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; cursor?: string }>;
}) {
  const sp = await searchParams;
  const session = await getSession("check_stock");
  if (!session?.activeStore) redirect("/onboarding");
  const store = session.activeStore;
  const showCosts = store.role !== "employee";

  const status = FILTERS.some((f) => f.key === sp.status) ? sp.status! : "all";
  const q = sp.q ?? "";

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("catalog_page", {
    p_stores: [store.id],
    p_search: q,
    p_status: status,
    p_active: status !== "inactive",
    p_main_only: false,
    p_after: readCursor(sp.cursor),
    p_limit: PAGE_SIZE,
  });
  if (error) throw error;
  const { rows, next } = dataPage<CatalogProduct>(data);

  return (
    <>
      <PageHeader
        title="Check Stock"
        crumbs={[{ label: "Operations" }, { label: "Check Stock" }]}
        actions={<ToolbarSearch placeholder="Search products…" />}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const params = new URLSearchParams();
          if (q) params.set("q", q);
          if (f.key !== "all") params.set("status", f.key);
          return (
            <Link
              key={f.key}
              href={`/check-stock?${params.toString()}`}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                status === f.key
                  ? "border-primary/50 bg-primary/15 text-primary-hover"
                  : "border-border text-muted hover:bg-surface-2",
              )}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      <StockExport
        key={`${store.id}:${status}:${q}:${sp.cursor ?? ""}`}
        status={status}
        search={q}
        currentRows={
          showCosts
            ? rows
            : rows.map((r) => ({
                name: r.name,
                quantity: r.quantity,
                stock_status: r.stock_status,
                selling_price: r.selling_price,
                is_active: r.is_active,
                tracking_type: r.tracking_type,
              }))
        }
      />
      <div className="rounded-lg border border-border bg-surface">
        {rows.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title="No products found"
            description={
              q
                ? "Try a different search."
                : "Add products or receive stock to see them here."
            }
          />
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH>Product</TH>
                  {showCosts && <TH>Category</TH>}
                  <TH className="text-right">In stock</TH>
                  <TH>Status</TH>
                  {showCosts && <TH className="text-right">Cost</TH>}
                  <TH className="text-right">Selling</TH>
                  {showCosts && <TH className="text-right">Stock value</TH>}
                </TR>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={r.id} className="cursor-pointer">
                    <TD className="font-medium">
                      <Link
                        href={`/products/${r.id}`}
                        className="hover:text-primary-hover"
                      >
                        {r.name}
                        {r.sku && (
                          <span className="block text-xs text-muted">
                            SKU: {r.sku}
                          </span>
                        )}
                      </Link>
                    </TD>
                    {showCosts && (
                      <TD className="text-muted">{r.category_name ?? "—"}</TD>
                    )}
                    <TD className="text-right tabular-nums">
                      {stockQuantity(r)}{" "}
                      <span className="text-xs text-muted">{r.unit}</span>
                    </TD>
                    <TD>
                      {r.is_active ? (
                        <StockStatusBadge status={r.stock_status} />
                      ) : (
                        <Badge variant="neutral">Inactive</Badge>
                      )}
                    </TD>
                    {showCosts && (
                      <TD className="text-right tabular-nums text-muted-foreground">
                        {money(r.cost_price, store.currency)}
                      </TD>
                    )}
                    <TD className="text-right tabular-nums">
                      {money(r.selling_price, store.currency)}
                    </TD>
                    {showCosts && (
                      <TD className="text-right tabular-nums">
                        {money(r.stock_value, store.currency)}
                      </TD>
                    )}
                  </TR>
                ))}
              </TBody>
            </Table>
            <CursorPagination
              next={next}
              current={sp.cursor}
              count={rows.length}
              params={{ q, status: status === "all" ? undefined : status }}
              basePath="/check-stock"
            />
          </>
        )}
      </div>
    </>
  );
}
