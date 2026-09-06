import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/shell/page-header";
import { ImportConsole } from "@/features/imports/import-console";
export default async function ImportsPage() {
  const session = await getSession();
  if (!session?.activeStore) redirect("/onboarding");
  if (session.activeStore.role === "employee") redirect("/");
  return (
    <>
      <PageHeader
        title="Excel imports"
        description="Download a template, review the changes and import products, suppliers or credit customers."
        crumbs={[{ label: "Catalog" }, { label: "Imports" }]}
      />
      <ImportConsole key={session.activeStore.id} />
    </>
  );
}
