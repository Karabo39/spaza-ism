import Link from "next/link";
import { notFound } from "next/navigation";
import { storeSetupSession } from "@/lib/store-setup-session";
import { StoreProvider } from "@/lib/store-context";
import { OfflineProvider } from "@/lib/offline/offline-context";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { StoreTeam } from "@/features/stores/store-team";
import { AddProductButton } from "@/features/products/add-product-button";
import { ImportConsole } from "@/features/imports/import-console";
import { GoodsInConsole } from "@/features/goods-in/goods-in-console";
import type { ModuleKey } from "@/lib/modules";
const sections: Record<string, { label: string; module: ModuleKey }> = {
  team: { label: "Assign Team Members", module: "users" },
  products: { label: "Add Products", module: "products" },
  imports: {
    label: "Import products and opening stock from Excel",
    module: "imports",
  },
  receive: { label: "Receive Stock", module: "goods_in_new_stock" },
};
export default async function Page({
  params,
}: {
  params: Promise<{ storeId: string; section?: string[] }>;
}) {
  const { storeId, section } = await params;
  const selected = section?.[0];
  if (section && (section.length !== 1 || !sections[selected!])) notFound();
  const session = await storeSetupSession(
    storeId,
    selected ? sections[selected].module : "stores",
  );
  return (
    <StoreProvider key={`${storeId}:${selected ?? "home"}`} session={session}>
      <OfflineProvider>
        <PageHeader
          title={session.activeStore.name}
          description="Store setup — changes apply to this store."
          actions={
            <Button asChild>
              <Link href="/stores">Exit My Store</Link>
            </Button>
          }
        />
        <nav aria-label="Store setup" className="mb-6 flex flex-wrap gap-3">
          {Object.entries(sections)
            .filter(([, s]) => session.activeStore.modules[s.module])
            .map(([path, s]) => (
              <Button
                key={path}
                asChild
                variant={selected === path ? "primary" : "outline"}
              >
                <Link
                  href={`/stores/${storeId}/${path}`}
                  aria-current={selected === path ? "page" : undefined}
                >
                  {s.label}
                </Link>
              </Button>
            ))}
        </nav>
        {selected && (
          <h2 className="mb-4 text-lg font-semibold">
            {sections[selected].label}
          </h2>
        )}
        {!selected && (
          <p className="text-muted">
            Choose a setup action above. Owners already have access to this
            store.
          </p>
        )}
        {selected === "team" && <StoreTeam />}
        {selected === "products" && <AddProductButton />}
        {selected === "imports" && (
          <ImportConsole initialKind="products" productsOnly />
        )}
        {selected === "receive" && <GoodsInConsole fixedLocation />}
      </OfflineProvider>
    </StoreProvider>
  );
}
