import { notFound, redirect } from "next/navigation";
import { getSession } from "./session";
import type { ModuleKey } from "./modules";
export async function warehouseSession(
  id: string,
  module: ModuleKey = "warehouse",
) {
  const session = await getSession();
  if (!session) redirect("/login");
  const warehouse = session.stores.find(
    (s) => s.id === id && s.locationType === "warehouse" && s.modules.warehouse,
  );
  if (!warehouse) notFound();
  if (!warehouse.modules[module]) redirect("/no-access");
  return { ...session, activeStore: warehouse };
}
