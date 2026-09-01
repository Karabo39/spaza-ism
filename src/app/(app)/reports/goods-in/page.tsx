import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/misc";
import { DateFilter } from "@/features/reports/date-filter";
import { ExportButton } from "@/features/reports/export-button";
import { money, dateTime } from "@/lib/format";
import { PackagePlus } from "lucide-react";

export default async function GoodsInReport({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session?.activeStore) redirect("/onboarding");
  const store = session.activeStore;
  const supabase = await createClient();

  let query = supabase.from("goods_in").select("id, reference, total_cost, created_at, suppliers(name), goods_in_items(id)").eq("store_id", store.id);
  if (sp.from) query = query.gte("created_at", sp.from);
  if (sp.to) query = query.lte("created_at", `${sp.to}T23:59:59`);
  const { data } = await query.order("created_at", { ascending: false }).limit(500);
  const rows = (data ?? []) as unknown as { id: string; reference: string | null; total_cost: number; created_at: string; suppliers: { name: string } | null; goods_in_items: { id: string }[] }[];
  const total = rows.reduce((s, r) => s + Number(r.total_cost), 0);

  const exportRows = rows.map((r) => ({ date: dateTime(r.created_at), reference: r.reference ?? "", supplier: r.suppliers?.name ?? "", items: r.goods_in_items?.length ?? 0, total_cost: r.total_cost }));
  const columns = [{ key: "date", label: "Date" }, { key: "reference", label: "Reference" }, { key: "supplier", label: "Supplier" }, { key: "items", label: "Items" }, { key: "total_cost", label: "Total cost" }];

  return (
    <>
      <PageHeader title="Goods In" crumbs={[{ label: "Reports", href: "/reports" }, { label: "Goods In" }]}
        description={`Total received: ${money(total, store.currency)}`}
        actions={<><DateFilter /><ExportButton rows={exportRows} columns={columns} filename="goods-in" /></>} />
      <div className="rounded-lg border border-border bg-surface">
        {rows.length === 0 ? <EmptyState icon={PackagePlus} title="No goods received in this range" /> : (
          <Table>
            <THead><TR><TH>Date</TH><TH>Reference</TH><TH>Supplier</TH><TH className="text-right">Items</TH><TH className="text-right">Total cost</TH></TR></THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD className="text-xs text-muted whitespace-nowrap">{dateTime(r.created_at)}</TD>
                  <TD className="font-medium">{r.reference ?? "—"}</TD>
                  <TD className="text-muted">{r.suppliers?.name ?? "—"}</TD>
                  <TD className="text-right tabular-nums">{r.goods_in_items?.length ?? 0}</TD>
                  <TD className="text-right tabular-nums font-medium">{money(r.total_cost, store.currency)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </>
  );
}
