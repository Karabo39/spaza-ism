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
  direction,
  searchParams,
}: {
  direction: "fast" | "slow";
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session?.activeStore) redirect("/onboarding");
  const store = session.activeStore;
  const supabase = await createClient();

  const { data, error } = await supabase
    .rpc("product_sales_summary", {
      p_store: store.id,
      p_from: sp.from ?? null,
      p_to: sp.to ?? null,
    })
    .order("sold_qty", { ascending: direction === "slow" })
    .order("product_id")
    .limit(50);
  if (error) throw error;
  const rows = (data ?? []) as {
    product_id: string;
    name: string;
    sold_qty: number;
    sold_value: number;
    current_qty: number;
  }[];

  const title =
    direction === "fast" ? "Fast Moving Products" : "Slow Moving Products";
  const exportRows = rows.map((r) => ({
    product: r.name,
    sold_qty: Number(r.sold_qty),
    sold_value: r.sold_value,
    current_qty: Number(r.current_qty),
  }));
  const columns = [
    { key: "product", label: "Product" },
    { key: "sold_qty", label: "Sold qty" },
    { key: "sold_value", label: "Sold value" },
    { key: "current_qty", label: "Current stock" },
  ];

  return (
    <>
      <PageHeader
        title={title}
        crumbs={[{ label: "Reports", href: "/reports" }, { label: title }]}
        description={
          direction === "fast"
            ? "Up to 50 best sellers by quantity sold in the selected period; all dates when no range is selected."
            : "Up to 50 products with the fewest units sold, including products with no sales in the selected period."
        }
        actions={
          <>
            <DateFilter />
            <ExportButton
              rows={exportRows}
              columns={columns}
              filename={direction === "fast" ? "fast-moving" : "slow-moving"}
            />
          </>
        }
      />
      <div className="rounded-lg border border-border bg-surface">
        {rows.length === 0 ? (
          <EmptyState icon={TrendingUp} title="No sales data yet" />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>#</TH>
                <TH>Product</TH>
                <TH className="text-right">Sold qty</TH>
                <TH className="text-right">Sold value</TH>
                <TH className="text-right">In stock</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r, i) => (
                <TR key={r.product_id}>
                  <TD className="text-muted tabular-nums">{i + 1}</TD>
                  <TD className="font-medium">{r.name}</TD>
                  <TD className="text-right tabular-nums">{qty(r.sold_qty)}</TD>
                  <TD className="text-right tabular-nums">
                    {money(r.sold_value, store.currency)}
                  </TD>
                  <TD className="text-right tabular-nums text-muted-foreground">
                    {qty(r.current_qty)}
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
