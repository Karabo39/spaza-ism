import { DocumentLogo } from "@/components/document-logo";
import { PageHeader } from "@/components/shell/page-header";
import { getSession } from "@/lib/session";
import { OnlineOrdersConsole } from "@/features/online-orders/online-orders-console";
export default async function OnlineOrdersPage() {
  const session = await getSession("orders_online");
  const documentLogo = session?.activeStore
    ? await DocumentLogo({ businessId: session.activeStore.businessId })
    : null;
  return (
    <>
      {documentLogo}
      <PageHeader
        title="Online Orders"
        description="Confirm payments, prepare collections and manage customer deliveries."
        crumbs={[
          { label: "Orders", href: "/orders" },
          { label: "Online Orders" },
        ]}
      />
      <OnlineOrdersConsole />
    </>
  );
}
