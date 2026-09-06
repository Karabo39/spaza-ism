import { PageHeader } from "@/components/shell/page-header";
import { TransfersConsole } from "@/features/operations/transfers-console";
export default function TransfersPage() {
  return <><PageHeader title="Transfer stock" description="Move stock between your assigned stores and warehouses with linked dispatch and receipt records." crumbs={[{ label: "Operations", href: "/operations" }, { label: "Transfer stock" }]} /><TransfersConsole /></>;
}
