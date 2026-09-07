import { PageHeader } from "@/components/shell/page-header";
import { OrdersConsole } from "@/features/billing/orders-console";
export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const { order } = await searchParams;
  return (
    <>
      <PageHeader
        title="Orders"
        description="Capture and confirm customer orders before creating an invoice."
        crumbs={[{ label: "Sales" }, { label: "Orders" }]}
      />
      <OrdersConsole initialOrder={order} />
    </>
  );
}
