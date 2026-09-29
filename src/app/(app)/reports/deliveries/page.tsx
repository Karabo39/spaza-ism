import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/shell/page-header";
import { DeliveryReport } from "@/features/deliveries/delivery-report";
export default async function Page() {
  await getSession("reports_delivery");
  return (
    <>
      <PageHeader
        title="Delivery Report"
        crumbs={[
          { label: "Reports", href: "/reports" },
          { label: "Deliveries" },
        ]}
        description="Customer deliveries, current status, attempts and delivery value."
      />
      <DeliveryReport />
    </>
  );
}
