import { PageHeader } from "@/components/shell/page-header";
import { OrdersConsole } from "@/features/billing/orders-console";
export default function OrdersPage(){return <><PageHeader title="Orders" description="Capture and confirm customer orders before creating an invoice." crumbs={[{label:"Sales"},{label:"Orders"}]}/><OrdersConsole/></>;}
