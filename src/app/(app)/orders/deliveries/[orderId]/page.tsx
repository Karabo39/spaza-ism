import { PageHeader } from "@/components/shell/page-header";
import { DeliveryPanel } from "@/features/deliveries/delivery-panel";
export default async function Page({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  return (
    <>
      <PageHeader
        title="Delivery details"
        crumbs={[
          { label: "Deliveries", href: "/orders/deliveries" },
          { label: "Details" },
        ]}
      />
      <DeliveryPanel orderId={orderId} />
    </>
  );
}
