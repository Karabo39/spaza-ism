import {PageHeader} from "@/components/shell/page-header";
import {ReturnsConsole} from "@/features/billing/returns-console";
export default async function ReturnsPage({searchParams}:{searchParams:Promise<{invoice?:string}>}){const {invoice}=await searchParams;return <><PageHeader title="Goods Return" description="Inspect returned goods, issue linked credit notes and record approved refunds." crumbs={[{label:"Sales"},{label:"Goods Return"}]}/><ReturnsConsole initialInvoice={invoice}/></>;}
