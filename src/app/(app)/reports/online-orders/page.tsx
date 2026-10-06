import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/shell/page-header";
import { OnlineOrdersReport } from "@/features/reports/online-orders-report";
export default async function Page() {
  await getSession("reports_online");
  return (
    <>
      <PageHeader
        title="Online Orders Report"
        description="Online order totals, fulfilment, payments and product performance."
      />
      <OnlineOrdersReport />
    </>
  );
}
