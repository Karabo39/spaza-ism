import { DocumentLogo } from "@/components/document-logo";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/shell/page-header";
import { OrdersConsole } from "@/features/billing/orders-console";
export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const session = await getSession("orders");
  const documentLogo = session?.activeStore
    ? await DocumentLogo({ businessId: session.activeStore.businessId })
    : null;
  const { order } = await searchParams;
  return (
    <>
      {documentLogo}
      <PageHeader
        title="Orders"
        description="Capture and confirm customer orders before creating an invoice."
        crumbs={[{ label: "Sales" }, { label: "Orders" }]}
      />
      <OrdersConsole initialOrder={order} />
    </>
  );
}
