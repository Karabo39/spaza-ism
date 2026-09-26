import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { WarehouseAdd } from "@/features/operations/warehouse-add";
import { WarehouseLocations } from "@/features/operations/warehouse-locations";
export default async function WarehousePage() {
  const session = await getSession();
  if (!session?.activeStore) redirect("/onboarding");
  const db = await createClient();
  const ids = session.stores
    .filter(
      (s) =>
        s.businessId === session.activeStore!.businessId &&
        s.locationType === "warehouse" &&
        s.modules.warehouse,
    )
    .map((s) => s.id);
  const [summary, metadata] = await Promise.all([
    db.rpc("warehouse_summary", { p_business: session.activeStore.businessId }),
    ids.length
      ? db.from("stores").select("id,code").in("id", ids)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (summary.error) throw summary.error;
  if (metadata.error) throw metadata.error;
  const rows = (summary.data ?? [])
    .filter((row) => ids.includes(row.location_id))
    .map((row) => ({
      ...row,
      code: metadata.data?.find((s) => s.id === row.location_id)?.code,
    }));
  return (
    <>
      <PageHeader
        title="Warehouse"
        description="Open a warehouse to manage its stock and operations."
        actions={<WarehouseAdd />}
      />
      <WarehouseLocations rows={rows} />
      {!rows.length && (
        <p className="text-muted">No warehouse is assigned to your account.</p>
      )}
    </>
  );
}
