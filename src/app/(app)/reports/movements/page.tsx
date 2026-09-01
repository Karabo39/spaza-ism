import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { DateFilter } from "@/features/reports/date-filter";
import { ExportButton } from "@/features/reports/export-button";
import { MOVEMENT_META } from "@/features/stock/movement-meta";
import { qty, dateTime } from "@/lib/format";
import { ArrowLeftRight } from "lucide-react";

export default async function MovementsReport({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session?.activeStore) redirect("/onboarding");
  const store = session.activeStore;
  const supabase = await createClient();

  let query = supabase.from("stock_movements")
    .select("id, movement_type, quantity_delta, quantity_before, quantity_after, reason, created_at, products(name)")
    .eq("store_id", store.id);
  if (sp.from) query = query.gte("created_at", sp.from);
  if (sp.to) query = query.lte("created_at", `${sp.to}T23:59:59`);
  const { data } = await query.order("created_at", { ascending: false }).limit(500);
  const rows = (data ?? []) as unknown as { id: string; movement_type: keyof typeof MOVEMENT_META; quantity_delta: number; quantity_before: number; quantity_after: number; reason: string | null; created_at: string; products: { name: string } | null }[];

  const exportRows = rows.map((m) => ({ date: dateTime(m.created_at), product: m.products?.name ?? "", type: MOVEMENT_META[m.movement_type]?.label ?? m.movement_type, change: m.quantity_delta, before: m.quantity_before, after: m.quantity_after, reason: m.reason ?? "" }));
  const columns = [
    { key: "date", label: "Date" }, { key: "product", label: "Product" }, { key: "type", label: "Type" },
    { key: "change", label: "Change" }, { key: "before", label: "Before" }, { key: "after", label: "After" }, { key: "reason", label: "Reason" },
  ];

  return (
    <>
      <PageHeader title="Stock Movements" crumbs={[{ label: "Reports", href: "/reports" }, { label: "Stock Movements" }]}
        actions={<><DateFilter /><ExportButton rows={exportRows} columns={columns} filename="stock-movements" /></>} />
      <div className="rounded-lg border border-border bg-surface">
        {rows.length === 0 ? <EmptyState icon={ArrowLeftRight} title="No movements in this range" /> : (
          <Table>
            <THead><TR><TH>Date</TH><TH>Product</TH><TH>Type</TH><TH className="text-right">Change</TH><TH className="text-right">Balance</TH><TH>Reason</TH></TR></THead>
            <TBody>
              {rows.map((m) => {
                const meta = MOVEMENT_META[m.movement_type] ?? { label: m.movement_type, variant: "neutral" as const };
                const pos = Number(m.quantity_delta) >= 0;
                return (
                  <TR key={m.id}>
                    <TD className="text-xs text-muted whitespace-nowrap">{dateTime(m.created_at)}</TD>
                    <TD className="font-medium">{m.products?.name ?? "—"}</TD>
                    <TD><Badge variant={meta.variant}>{meta.label}</Badge></TD>
                    <TD className={`text-right tabular-nums ${pos ? "text-success" : "text-danger"}`}>{pos ? "+" : ""}{qty(m.quantity_delta)}</TD>
                    <TD className="text-right tabular-nums text-muted-foreground">{qty(m.quantity_after)}</TD>
                    <TD className="text-xs text-muted max-w-[16rem] truncate">{m.reason ?? "—"}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </div>
    </>
  );
}
