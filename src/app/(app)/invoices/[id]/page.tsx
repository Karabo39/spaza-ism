import { notFound,redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { InvoiceWorkspace } from "@/features/billing/invoice-workspace";
export default async function InvoicePage({params}:{params:Promise<{id:string}>}){
  const {id}=await params;const session=await getSession();if(!session?.activeStore)redirect("/onboarding");const db=await createClient();
  const {data:invoice,error}=await db.from("v_invoice_balances").select("*").eq("id",id).eq("store_id",session.activeStore.id).maybeSingle();if(error)throw error;if(!invoice)notFound();
  const [items,entries,account]=await Promise.all([db.from("sales_invoice_items").select("*").eq("invoice_id",id).order("product_name"),db.from("invoice_entries").select("*").eq("invoice_id",id).order("created_at"),db.from("credit_accounts").select("balance,credit_limit").eq("customer_id",invoice.customer_id).single()]);
  if(items.error||entries.error||account.error)throw items.error??entries.error??account.error;
  return <><PageHeader title={invoice.reference} crumbs={[{label:"Invoices",href:"/invoices"},{label:invoice.customer_name}]} description={`${invoice.store_name} · ${invoice.status.replaceAll("_"," ")}`}/><InvoiceWorkspace invoice={invoice} items={items.data??[]} entries={entries.data??[]} account={account.data!}/></>;
}
