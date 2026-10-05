import { PageHeader } from "@/components/shell/page-header";
import { getSession } from "@/lib/session";
import { OnlineOrdersConsole } from "@/features/online-orders/online-orders-console";
export default async function OnlineOrdersPage() {
  await getSession("orders_online");
  return (
    <>
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
