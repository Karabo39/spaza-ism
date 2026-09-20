import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/shell/page-header";
import { UnpackConsole } from "@/features/operations/unpack-console";
export default async function UnpackPage() {
  const session = await getSession("operations");
  return (
    <>
      <PageHeader
        title="Unpack Bulk Stock"
        description="Convert packs into individual units at this store. Stock changes and the conversion ratio are recorded in the audit history."
        crumbs={[{ label: "Stock Control" }, { label: "Unpack Bulk Stock" }]}
      />
      <UnpackConsole key={session!.activeStore!.id} />
    </>
  );
}
