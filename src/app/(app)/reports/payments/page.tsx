import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { DateFilter } from "@/features/reports/date-filter";
import { ExportButton } from "@/features/reports/export-button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { money, dateTime } from "@/lib/format";
export default async function PaymentReport({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const sp=await searchParams; const session=await getSession();
  if (!session?.activeStore) redirect("/onboarding");
  const store=session.activeStore; const db=await createClient();
  let query=db.from("goods_out").select("id,created_at,sale_type,total_amount,payment_reference").eq("store_id",store.id);
  if(sp.from) query=query.gte("created_at",sp.from);
  if(sp.to) query=query.lt("created_at",`${sp.to}T23:59:59.999999`);
  const {data,error}=await query.order("created_at",{ascending:false}).limit(1000);
  if(error) throw error;
  const rows=(data??[]).map(r=>({reference:r.id,date:dateTime(r.created_at),method:r.sale_type,amount:Number(r.total_amount),slip:r.payment_reference??""}));
  return <>
    <PageHeader title="Payment Report" description="Reconcile recorded checkout sales by Cash, Card/EFT and Credit, including card slip references." crumbs={[{label:"Reports",href:"/reports"},{label:"Payments"}]} actions={<><DateFilter/><ExportButton rows={rows} columns={[{key:"reference",label:"Sale"},{key:"date",label:"Date"},{key:"method",label:"Method"},{key:"amount",label:"Amount"},{key:"slip",label:"Card/EFT reference"}]} filename="payments"/></>}/>
    {rows.length===1000&&<p className="mb-4 text-warning">Showing the latest 1,000 sales. Narrow the date range for a complete reconciliation.</p>}
    <div className="mb-5 grid gap-3 sm:grid-cols-3">{["CASH","CARD_EFT","CREDIT"].map(method=><div key={method} className="rounded-lg border border-border bg-surface p-4"><p className="text-sm text-muted">{method.replace("_","/")}</p><p className="text-xl font-semibold">{money(rows.filter(r=>r.method===method).reduce((sum,r)=>sum+r.amount,0),store.currency)}</p></div>)}</div>
    <p className="mb-3 text-sm text-muted">Credit represents sales charged to customer accounts. Card/EFT records payments taken on your external machine or bank account.</p>
    <Table><THead><TR><TH>Date</TH><TH>Sale reference</TH><TH>Method</TH><TH>Card/EFT reference</TH><TH>Amount</TH></TR></THead><TBody>{rows.map(r=><TR key={r.reference}><TD>{r.date}</TD><TD>{r.reference}</TD><TD>{r.method}</TD><TD>{r.slip||"—"}</TD><TD>{money(r.amount,store.currency)}</TD></TR>)}</TBody></Table>
  </>;
}
