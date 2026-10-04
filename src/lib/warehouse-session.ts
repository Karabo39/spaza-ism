import { notFound, redirect } from "next/navigation";
import { getSession } from "./session";
import type { ModuleKey } from "./modules";
import { PERMISSIONS, type ModulePermissions } from "./modules";
import { createClient } from "./supabase/server";
export type ManagedWarehouse = {
  location_id: string;
  name: string;
  currency: string;
  code: string | null;
  is_active: boolean;
  can_manage: boolean;
  product_count: number;
  stock_quantity: number;
  stock_value: number;
};
export async function warehouseSession(
  id: string,
  module: ModuleKey = "warehouse",
) {
  const session = await getSession();
  if (!session) redirect("/login");
  const warehouse = session.stores.find(
    (s) => s.id === id && s.locationType === "warehouse" && s.modules.warehouse,
  );
  if (!warehouse) {
    if (!session.activeStore || module !== "warehouse") notFound();
    const { data, error } = await (
      await createClient()
    ).rpc("warehouse_management", {
      p_business: session.activeStore.businessId,
    });
    if (error) throw error;
    const disabled = (data as unknown as ManagedWarehouse[]).find(
      (s) => s.location_id === id && !s.is_active && s.can_manage,
    );
    if (!disabled) notFound();
    const modules = Object.fromEntries(
      PERMISSIONS.map((p) => [p.key, false]),
    ) as ModulePermissions;
    modules.warehouse = true;
    modules.warehouse_disable = true;
    return {
      ...session,
      activeStore: {
        ...session.activeStore,
        id,
        name: disabled.name,
        currency: disabled.currency,
        locationType: "warehouse" as const,
        isActive: false,
        modules,
      },
    };
  }
  if (!warehouse.modules[module]) redirect("/no-access");
  return { ...session, activeStore: warehouse };
}
