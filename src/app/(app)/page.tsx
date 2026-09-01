import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { MetricCard } from "@/features/dashboard/metric-card";
import { QuickActions } from "@/features/dashboard/quick-actions";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { money, qty, dateTime } from "@/lib/format";
import {
  Wallet, TriangleAlert, PackageX, Users, CalendarClock, Boxes, Activity,
} from "lucide-react";
import { MOVEMENT_META } from "@/features/stock/movement-meta";

type Summary = {
  stock_value: number; retail_value: number; product_count: number;
  low_count: number; out_count: number; reorder_count: number;
  outstanding_credit: number; credit_customers: number; over_limit: number;
  expiring_30: number; expired: number;
};

export default async function DashboardPage() {
  const session = await getSession();
  if (!session?.activeStore) redirect("/onboarding");
  const store = session.activeStore;
  const supabase = await createClient();

  const [{ data: summaryRaw }, { data: movements }] = await Promise.all([
    supabase.rpc("dashboard_summary", { p_store: store.id }),
    supabase
      .from("stock_movements")
      .select("id, movement_type, quantity_delta, quantity_after, created_at, products(name)")
      .eq("store_id", store.id)
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  const s = (summaryRaw as Summary | null) ?? {
    stock_value: 0, retail_value: 0, product_count: 0, low_count: 0, out_count: 0,
    reorder_count: 0, outstanding_credit: 0, credit_customers: 0, over_limit: 0,
    expiring_30: 0, expired: 0,
  };

  return (
    <>
      <PageHeader
        title={`Good day${session.fullName ? ", " + session.fullName.split(" ")[0] : ""}`}
        description={`Here's what's happening at ${store.name}.`}
      />

      <section className="mb-6">
        <QuickActions />
      </section>

      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <MetricCard label="Stock value" value={money(s.stock_value, store.currency)}
          sub={`${s.product_count} products`} icon={Boxes} href="/check-stock" />
        <MetricCard label="Low stock" value={String(s.low_count)} sub="need restock soon"
          icon={TriangleAlert} tone={s.low_count > 0 ? "warning" : "default"} href="/low-stock" />
        <MetricCard label="Out of stock" value={String(s.out_count)} sub="unavailable"
          icon={PackageX} tone={s.out_count > 0 ? "danger" : "default"} href="/check-stock?status=out" />
        <MetricCard label="Outstanding credit" value={money(s.outstanding_credit, store.currency)}
          sub={`${s.credit_customers} customers`} icon={Wallet} tone="accent" href="/credit" />
        <MetricCard label="Over limit" value={String(s.over_limit)} sub="credit customers"
          icon={Users} tone={s.over_limit > 0 ? "danger" : "default"} href="/credit?filter=over" />
        <MetricCard label="Expiring soon" value={String(s.expiring_30)} sub={`${s.expired} expired`}
          icon={CalendarClock} tone={s.expired > 0 ? "danger" : s.expiring_30 > 0 ? "warning" : "default"} href="/expiry" />
      </section>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Activity className="size-4 text-muted" /> Recent stock movements
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {movements && movements.length > 0 ? (
            <Table>
              <THead>
                <TR>
                  <TH>Product</TH>
                  <TH>Type</TH>
                  <TH className="text-right">Change</TH>
                  <TH className="text-right">Balance</TH>
                  <TH className="text-right">When</TH>
                </TR>
              </THead>
              <TBody>
                {movements.map((m) => {
                  const meta = MOVEMENT_META[m.movement_type] ?? { label: m.movement_type, variant: "neutral" as const };
                  const p = m.products as unknown as { name: string } | null;
                  const positive = Number(m.quantity_delta) >= 0;
                  return (
                    <TR key={m.id}>
                      <TD className="font-medium">{p?.name ?? "—"}</TD>
                      <TD><Badge variant={meta.variant}>{meta.label}</Badge></TD>
                      <TD className={`text-right tabular-nums ${positive ? "text-success" : "text-danger"}`}>
                        {positive ? "+" : ""}{qty(m.quantity_delta)}
                      </TD>
                      <TD className="text-right tabular-nums text-muted-foreground">{qty(m.quantity_after)}</TD>
                      <TD className="text-right text-xs text-muted">{dateTime(m.created_at)}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          ) : (
            <EmptyState icon={Activity} title="No stock movements yet"
              description="Receive stock or record a sale and it will show up here." />
          )}
        </CardContent>
      </Card>
    </>
  );
}
