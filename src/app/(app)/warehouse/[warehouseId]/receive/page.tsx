import { warehouseSession } from "@/lib/warehouse-session";
import { PageHeader } from "@/components/shell/page-header";
import { GoodsInConsole } from "@/features/goods-in/goods-in-console";
export default async function Page({
  params,
}: {
  params: Promise<{ warehouseId: string }>;
}) {
  const { warehouseId } = await params;
  const session = await warehouseSession(warehouseId, "goods_in_new_stock");
  return (
    <>
      <PageHeader
        title="Receive Warehouse Stock"
        description={session.activeStore.name}
        crumbs={[
          { label: "Warehouse", href: "/warehouse" },
          { label: "Receive Warehouse Stock" },
        ]}
      />
      <GoodsInConsole />
    </>
  );
}
