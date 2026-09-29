import { PageHeader } from "@/components/shell/page-header";
import { DeliveryQueue } from "@/features/deliveries/delivery-queue";
export default function Page() {
  return (
    <>
      <PageHeader
        title="Delivery Management"
        description="Dispatch, reschedule and complete paid customer deliveries."
        crumbs={[{ label: "Orders", href: "/orders" }, { label: "Deliveries" }]}
      />
      <DeliveryQueue />
    </>
  );
}
