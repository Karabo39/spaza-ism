import type { ManagedWarehouse } from "@/lib/warehouse-session";
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
  const { data, error } = await db.rpc("warehouse_management", {
    p_business: session.activeStore.businessId,
  });
  if (error) throw error;
  const rows = (data ?? []) as unknown as ManagedWarehouse[];
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
