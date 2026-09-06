import { PageHeader } from "@/components/shell/page-header";
import { TransfersConsole } from "@/features/operations/transfers-console";
export default function ReceiveTransfersPage() {
  return <><PageHeader title="Receive transfer" description="Confirm arrival of dispatched stock. Received quantities become available at the destination." crumbs={[{ label: "Operations", href: "/operations" }, { label: "Receive transfer" }]} /><TransfersConsole receiving /></>;
}
