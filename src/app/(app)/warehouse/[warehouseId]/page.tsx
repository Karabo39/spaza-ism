import StockPage from "./stock/page";
import { warehouseSession } from "@/lib/warehouse-session";
import { createClient } from "@/lib/supabase/server";
import { WarehouseLocations } from "@/features/operations/warehouse-locations";
import { WarehouseCatalogTools } from "@/features/operations/warehouse-catalog-tools";
import { WarehouseStateButton } from "@/features/operations/warehouse-state-button";
import type { ManagedWarehouse } from "@/lib/warehouse-session";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { TransfersConsole } from "@/features/operations/transfers-console";
import { PageHeader } from "@/components/shell/page-header";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ warehouseId: string }>;
  searchParams: Promise<{ cursor?: string; q?: string }>;
}) {
  const { warehouseId } = await params;
  const session = await warehouseSession(warehouseId);
  const db = await createClient();
  const summary = await db.rpc("warehouse_management", {
    p_business: session.activeStore.businessId,
  });
  if (summary.error) throw summary.error;
  return (
    <>
      <PageHeader
        title={session.activeStore.name}
        actions={
          <>
            {session.activeStore.isActive !== false && (
              <WarehouseCatalogTools />
            )}
            <WarehouseStateButton
              active={session.activeStore.isActive !== false}
            />
          </>
        }
      />
      <WarehouseLocations
        opened
        rows={((summary.data ?? []) as unknown as ManagedWarehouse[]).filter(
          (s) => s.location_id === warehouseId,
        )}
      />
      {session.activeStore.isActive === false && (
        <div className="mt-4 space-y-3">
          <p>
            This warehouse is disabled. Enable it to resume stock operations.
            Automatic product sync remains off until explicitly enabled.
          </p>
          <Button asChild>
            <Link href="/warehouse">Exit Warehouse</Link>
          </Button>
        </div>
      )}
      {session.activeStore.modules.check_stock && (
        <section className="mt-6">
          <StockPage params={params} searchParams={searchParams} />
        </section>
      )}
      {session.activeStore.modules.operations && (
        <section className="mt-6">
          <TransfersConsole historyOnly />
        </section>
      )}
    </>
  );
}
