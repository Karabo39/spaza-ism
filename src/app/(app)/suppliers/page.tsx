import { PageHeader } from "@/components/shell/page-header";
import { SuppliersManager } from "@/features/suppliers/suppliers-manager";

export default function SuppliersPage() {
  return (
    <>
      <PageHeader title="Suppliers" crumbs={[{ label: "Catalog" }, { label: "Suppliers" }]}
        description="Manage the suppliers you receive stock from." />
      <SuppliersManager />
    </>
  );
}
