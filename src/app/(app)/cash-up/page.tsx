import { PageHeader } from "@/components/shell/page-header";
import { CashUpConsole } from "@/features/cash-up/cash-up-console";
export default function CashUpPage() {
  return <><PageHeader title="Daily cash-up" description="Reconcile the cash drawer for one store and one South African business day." /><CashUpConsole /></>;
}
