import { RecentMovements } from "@/features/dashboard/recent-movements";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { MetricCard } from "@/features/dashboard/metric-card";
import { QuickActions } from "@/features/dashboard/quick-actions";
import { money } from "@/lib/format";
import {
  Wallet,
  TriangleAlert,
  PackageX,
  Users,
  CalendarClock,
  Boxes,
} from "lucide-react";
import { LocationOverview } from "@/features/dashboard/location-overview";
import { InvoiceSummary } from "@/features/billing/invoice-summary";

type Summary = {
  stock_value: number;
  retail_value: number;
  product_count: number;
  low_count: number;
  out_count: number;
  reorder_count: number;
  outstanding_credit: number;
  credit_customers: number;
  over_limit: number;
  expiring_30: number;
  expired: number;
};

export default async function DashboardPage() {
  const session = await getSession("dashboard");
  if (!session?.activeStore) redirect("/onboarding");
  const store = session.activeStore;
  const supabase = await createClient();

  const { data: summaryRaw } =
    store.role === "employee"
      ? { data: null }
      : await supabase.rpc("dashboard_summary", {
          p_store: store.id,
        });

  const s = (summaryRaw as Summary | null) ?? {
    stock_value: 0,
    retail_value: 0,
    product_count: 0,
    low_count: 0,
    out_count: 0,
    reorder_count: 0,
    outstanding_credit: 0,
    credit_customers: 0,
    over_limit: 0,
    expiring_30: 0,
    expired: 0,
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
      {store.modules.dashboard_locations && <LocationOverview />}
      {store.modules.dashboard_invoicing && (
        <InvoiceSummary
          storeId={store.id}
          currency={store.currency}
          permissions={store.modules}
          canOpen={store.modules.invoices_view_invoices}
        />
      )}

      {store.role !== "employee" && (
        <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {store.modules.dashboard_check_stock && (
            <MetricCard
              label="Stock value"
              value={money(s.stock_value, store.currency)}
              sub={`${s.product_count} products`}
              icon={Boxes}
              href={
                store.modules.dashboard_check_stock ? "/check-stock" : undefined
              }
            />
          )}
          {store.modules.dashboard_check_stock && (
            <MetricCard
              label="Low stock"
              value={String(s.low_count)}
              sub="need restock soon"
              icon={TriangleAlert}
              tone={s.low_count > 0 ? "warning" : "default"}
              href={store.modules.low_stock ? "/low-stock" : undefined}
            />
          )}
          {store.modules.dashboard_check_stock && (
            <MetricCard
              label="Out of stock"
              value={String(s.out_count)}
              sub="unavailable"
              icon={PackageX}
              tone={s.out_count > 0 ? "danger" : "default"}
              href={
                store.modules.dashboard_check_stock
                  ? "/check-stock?status=out"
                  : undefined
              }
            />
          )}
          {store.modules.dashboard_credit && (
            <MetricCard
              label="Outstanding credit"
              value={money(s.outstanding_credit, store.currency)}
              sub={`${s.credit_customers} customers`}
              icon={Wallet}
              tone="accent"
              href={store.modules.dashboard_credit ? "/credit" : undefined}
            />
          )}
          {store.modules.dashboard_credit && (
            <MetricCard
              label="Over limit"
              value={String(s.over_limit)}
              sub="credit customers"
              icon={Users}
              tone={s.over_limit > 0 ? "danger" : "default"}
              href={
                store.modules.dashboard_credit
                  ? "/credit?filter=over"
                  : undefined
              }
            />
          )}
          {store.modules.dashboard_check_stock && (
            <MetricCard
              label="Expiring soon"
              value={String(s.expiring_30)}
              sub={`${s.expired} expired`}
              icon={CalendarClock}
              tone={
                s.expired > 0
                  ? "danger"
                  : s.expiring_30 > 0
                    ? "warning"
                    : "default"
              }
              href={store.modules.expiry ? "/expiry" : undefined}
            />
          )}
        </section>
      )}

      {store.modules.dashboard_movements && <RecentMovements key={store.id} />}
    </>
  );
}
