import { warehouseSession } from "@/lib/warehouse-session";
import { PageHeader } from "@/components/shell/page-header";
import { UnpackConsole } from "@/features/operations/unpack-console";
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
        title="Unpack Warehouse Bulk Stock"
        description={session.activeStore.name}
        crumbs={[
          { label: "Warehouse", href: "/warehouse" },
          { label: "Unpack Warehouse Bulk Stock" },
        ]}
      />
      <UnpackConsole />
    </>
  );
}
