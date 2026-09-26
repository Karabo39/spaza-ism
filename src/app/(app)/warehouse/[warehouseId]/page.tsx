import StockPage from "./stock/page";
import { warehouseSession } from "@/lib/warehouse-session";
import { createClient } from "@/lib/supabase/server";
import { WarehouseLocations } from "@/features/operations/warehouse-locations";
import { WarehouseCatalogTools } from "@/features/operations/warehouse-catalog-tools";
import { TransfersConsole } from "@/features/operations/transfers-console";
import { PageHeader } from "@/components/shell/page-header";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ warehouseId: string }>;
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { warehouseId } = await params;
  const session = await warehouseSession(warehouseId);
  const db = await createClient();
  const [summary, metadata] = await Promise.all([
    db.rpc("warehouse_summary", { p_business: session.activeStore.businessId }),
    db.from("stores").select("code").eq("id", warehouseId).single(),
  ]);
  if (summary.error) throw summary.error;
  if (metadata.error) throw metadata.error;
  return (
    <>
      <PageHeader
        title={session.activeStore.name}
        actions={<WarehouseCatalogTools />}
      />
      <WarehouseLocations
        opened
        rows={(summary.data ?? [])
          .filter((s) => s.location_id === warehouseId)
          .map((s) => ({ ...s, code: metadata.data.code }))}
      />
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
