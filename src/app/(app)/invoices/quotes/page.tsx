import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/shell/page-header";
import { QuotesConsole } from "@/features/billing/quotes-console";
export default async function QuotesPage() {
  const session = await getSession("invoices");
  if (
    !session?.activeStore?.modules.invoices_create_quotes &&
    !session?.activeStore?.modules.invoices_view_quotes
  )
    redirect("/no-access");
  return (
    <>
      <PageHeader
        title="Quotations"
        description="Prepare customer quotes and review stock before creating an order."
        crumbs={[
          { label: "Sales" },
          { label: "Invoices", href: "/invoices" },
          { label: "Quotations" },
        ]}
      />
      <QuotesConsole key={session!.activeStore!.id} />
    </>
  );
}
