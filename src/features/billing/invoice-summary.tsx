import Link from "next/link";
import {createClient} from "@/lib/supabase/server";
import {money} from "@/lib/format";
export async function InvoiceSummary({storeId,currency}:{storeId:string;currency:string}){
  const db=await createClient();const {data,error}=await db.rpc("invoice_summary",{p_store:storeId});if(error)throw error;const values=(data??{}) as Record<string,number>;
  return <section className="mb-6"><div className="mb-3 flex justify-between"><h2 className="font-semibold">Invoicing</h2><Link className="text-sm text-accent" href="/invoices">View invoices</Link></div><div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">{[["invoiced","Invoiced"],["paid","Paid / allocated"],["outstanding","Outstanding"],["overdue","Overdue"],["credit_notes","Credit notes"],["month_to_date","Invoiced this month"]].map(([key,label])=><div key={key} className="rounded-lg border border-border bg-surface p-3"><p className="text-xs text-muted">{label}</p><p className="mt-1 font-semibold tabular-nums">{money(values[key]??0,currency)}</p></div>)}</div></section>;
}
