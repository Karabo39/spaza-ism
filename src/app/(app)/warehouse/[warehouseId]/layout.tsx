import Link from "next/link";
import { Button } from "@/components/ui/button";
import { warehouseSession } from "@/lib/warehouse-session";
import { StoreProvider } from "@/lib/store-context";
import { OfflineProvider } from "@/lib/offline/offline-context";
export default async function WarehouseLayout({
  params,
  children,
}: {
  params: Promise<{ warehouseId: string }>;
  children: React.ReactNode;
}) {
  const { warehouseId } = await params;
  const session = await warehouseSession(warehouseId);
  return (
    <StoreProvider key={warehouseId} session={session}>
      <OfflineProvider>
        <div className="mb-4 flex flex-wrap gap-2">
          <Button asChild size="sm">
            <Link href="/warehouse">Exit Warehouse</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={`/warehouse/${warehouseId}`}>Warehouse overview</Link>
          </Button>
        </div>
        {children}
      </OfflineProvider>
    </StoreProvider>
  );
}
