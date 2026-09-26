import { notFound, redirect } from "next/navigation";
import { getSession } from "./session";
import type { ModuleKey } from "./modules";
export async function storeSetupSession(
  id: string,
  module: ModuleKey = "stores",
) {
  const session = await getSession();
  if (!session) redirect("/login");
  const store = session.stores.find(
    (s) => s.id === id && s.locationType === "store",
  );
  if (!store) notFound();
  if (!store.modules.stores || !store.modules[module] || store.role !== "owner")
    redirect("/no-access");
  return { ...session, activeStore: store };
}
