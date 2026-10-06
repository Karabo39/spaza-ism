import { DocumentLogo } from "@/components/document-logo";
import { getSession } from "@/lib/session";
export default async function ModuleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession("reports");
  const logo = session?.activeStore
    ? await DocumentLogo({ businessId: session.activeStore.businessId })
    : null;
  return (
    <>
      <div>{logo}</div>
      {children}
    </>
  );
}
