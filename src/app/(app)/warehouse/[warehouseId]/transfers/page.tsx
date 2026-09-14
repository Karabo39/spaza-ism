import { warehouseSession } from "@/lib/warehouse-session";
import { PageHeader } from "@/components/shell/page-header";
import { TransfersConsole } from "@/features/operations/transfers-console";
export default async function Page({
  params,
}: {
  params: Promise<{ warehouseId: string }>;
}) {
  const { warehouseId } = await params;
  const session = await warehouseSession(warehouseId, "operations");
  return (
    <>
      <PageHeader
        title="Transfer to Store"
        description={session.activeStore.name}
        crumbs={[
          { label: "Warehouse", href: "/warehouse" },
          { label: "Transfer to Store" },
        ]}
      />
      <TransfersConsole />
    </>
  );
}
