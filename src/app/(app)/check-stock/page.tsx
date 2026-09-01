import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { ToolbarSearch } from "@/components/shell/toolbar-search";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/misc";
import { Pagination } from "@/components/ui/pagination";
import { StockStatusBadge } from "@/features/stock/status-badge";
import { money, qty } from "@/lib/format";
import { Boxes } from "lucide-react";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;
const FILTERS = [
  { key: "all", label: "All" },
  { key: "low", label: "Low" },
  { key: "out", label: "Out of stock" },
  { key: "reorder", label: "Reorder" },
];

export default async function CheckStockPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session?.activeStore) redirect("/onboarding");
  const store = session.activeStore;
  const page = Math.max(1, Number(sp.page) || 1);
  const status = sp.status ?? "all";
  const q = sp.q ?? "";

  const supabase = await createClient();
  let query = supabase
    .from("v_product_stock")
    .select("*", { count: "exact" })
    .eq("store_id", store.id)
    .eq("is_active", true);
  if (q) query = query.ilike("name", `%${q}%`);
  if (status === "low") query = query.eq("stock_status", "low");
  else if (status === "out") query = query.eq("stock_status", "out");
  else if (status === "reorder") query = query.in("stock_status", ["low", "out", "reorder"]);

  const { data, count } = await query
    .order("name")
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const rows = data ?? [];

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
            <Link key={f.key} href={`/check-stock?${params.toString()}`}
              className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                status === f.key ? "border-primary/50 bg-primary/15 text-primary-hover" : "border-border text-muted hover:bg-surface-2")}>
              {f.label}
            </Link>
          );
        })}
      </div>

      <div className="rounded-lg border border-border bg-surface">
        {rows.length === 0 ? (
          <EmptyState icon={Boxes} title="No products found"
            description={q ? "Try a different search." : "Add products or receive stock to see them here."} />
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH>Product</TH>
                  <TH>Category</TH>
                  <TH className="text-right">In stock</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Cost</TH>
                  <TH className="text-right">Selling</TH>
                  <TH className="text-right">Stock value</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={r.id} className="cursor-pointer">
                    <TD className="font-medium">
                      <Link href={`/products/${r.id}`} className="hover:text-primary-hover">{r.name}</Link>
                    </TD>
                    <TD className="text-muted">{r.category_name ?? "—"}</TD>
                    <TD className="text-right tabular-nums">{qty(r.quantity)} <span className="text-xs text-muted">{r.unit}</span></TD>
                    <TD><StockStatusBadge status={r.stock_status} /></TD>
                    <TD className="text-right tabular-nums text-muted-foreground">{money(r.cost_price, store.currency)}</TD>
                    <TD className="text-right tabular-nums">{money(r.selling_price, store.currency)}</TD>
                    <TD className="text-right tabular-nums">{money(r.stock_value, store.currency)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0}
              params={{ q, status: status === "all" ? undefined : status }} basePath="/check-stock" />
          </>
        )}
      </div>
    </>
  );
}
