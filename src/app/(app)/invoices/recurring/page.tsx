import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/shell/page-header";
import { RecurringInvoices } from "@/features/billing/recurring-invoices";
export default async function Page() {
  const session = await getSession("invoices");
  const s = session?.activeStore;
  if (!s) redirect("/onboarding");
  if (
    !s.modules.invoices_manage ||
    !s.modules.invoices_create_from_order ||
    !s.modules.invoices_view_invoices ||
    !s.modules.orders_recent
  )
    redirect("/no-access");
  return (
    <>
      <PageHeader
        title="Recurring Invoices"
        description="Schedule customer invoices with agreed prices and payment terms."
        crumbs={[
          { label: "Invoicing", href: "/invoices" },
          { label: "Recurring Invoices" },
        ]}
      />
      <RecurringInvoices key={s.id} />
    </>
  );
}
