import { PageHeader } from "@/components/shell/page-header";
import { CashUpConsole } from "@/features/cash-up/cash-up-console";
export default function CashUpPage() {
  return <><PageHeader title="Daily cash-up" description="Start shifts, reconcile the shared drawer and review each user’s cash-up history." /><CashUpConsole /></>;
}
