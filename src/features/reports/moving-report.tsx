import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/misc";
import { DateFilter } from "@/features/reports/date-filter";
import { ExportButton } from "@/features/reports/export-button";
import { money, qty } from "@/lib/format";
import { TrendingUp } from "lucide-react";

export async function MovingReport({
  direction, searchParams,
}: {
  direction: "fast" | "slow";
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session?.activeStore) redirect("/onboarding");
  const store = session.activeStore;
  const supabase = await createClient();

  const { data } = await supabase.rpc("product_sales_summary", {
    p_store: store.id, p_from: sp.from ?? null, p_to: sp.to ?? null,
  });
  let rows = (data ?? []) as { product_id: string; name: string; sold_qty: number; sold_value: number; current_qty: number }[];
  rows = rows.sort((a, b) => direction === "fast" ? Number(b.sold_qty) - Number(a.sold_qty) : Number(a.sold_qty) - Number(b.sold_qty)).slice(0, 50);

  const title = direction === "fast" ? "Fast Moving Products" : "Slow Moving Products";
  const exportRows = rows.map((r) => ({ product: r.name, sold_qty: qty(r.sold_qty), sold_value: r.sold_value, current_qty: qty(r.current_qty) }));
  const columns = [{ key: "product", label: "Product" }, { key: "sold_qty", label: "Sold qty" }, { key: "sold_value", label: "Sold value" }, { key: "current_qty", label: "Current stock" }];

  return (
    <>
      <PageHeader title={title} crumbs={[{ label: "Reports", href: "/reports" }, { label: title }]}
        description={direction === "fast" ? "Your best sellers by quantity sold." : "Products barely moving — consider promotions or reducing orders."}
        actions={<><DateFilter /><ExportButton rows={exportRows} columns={columns} filename={direction === "fast" ? "fast-moving" : "slow-moving"} /></>} />
      <div className="rounded-lg border border-border bg-surface">
        {rows.length === 0 ? <EmptyState icon={TrendingUp} title="No sales data yet" /> : (
          <Table>
            <THead><TR><TH>#</TH><TH>Product</TH><TH className="text-right">Sold qty</TH><TH className="text-right">Sold value</TH><TH className="text-right">In stock</TH></TR></THead>
            <TBody>
              {rows.map((r, i) => (
                <TR key={r.product_id}>
                  <TD className="text-muted tabular-nums">{i + 1}</TD>
                  <TD className="font-medium">{r.name}</TD>
                  <TD className="text-right tabular-nums">{qty(r.sold_qty)}</TD>
                  <TD className="text-right tabular-nums">{money(r.sold_value, store.currency)}</TD>
                  <TD className="text-right tabular-nums text-muted-foreground">{qty(r.current_qty)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </>
  );
}
