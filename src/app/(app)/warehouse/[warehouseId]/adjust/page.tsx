import { warehouseSession } from "@/lib/warehouse-session";
import { PageHeader } from "@/components/shell/page-header";
import { AdjustConsole } from "@/features/adjust/adjust-console";
export default async function Page({
  params,
}: {
  params: Promise<{ warehouseId: string }>;
}) {
  const { warehouseId } = await params;
  const session = await warehouseSession(warehouseId, "adjust");
  return (
    <>
      <PageHeader
        title="Adjust Warehouse Stock"
        description={session.activeStore.name}
        crumbs={[
          { label: "Warehouse", href: "/warehouse" },
          { label: "Adjust Warehouse Stock" },
        ]}
      />
      <AdjustConsole />
    </>
  );
}
