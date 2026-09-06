import Link from "next/link";
import {notFound} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
import {PrintReceipt} from "@/features/billing/print-receipt";
import {money,dateOnly,dateTime} from "@/lib/format";
export default async function ReceiptPage({params}:{params:Promise<{id:string}>}){
  const {id}=await params;const db=await createClient();const {data:i,error}=await db.from("v_invoice_balances").select("*").eq("id",id).maybeSingle();if(error)throw error;if(!i)notFound();
  const [lines,entries]=await Promise.all([db.from("sales_invoice_items").select("*").eq("invoice_id",id).order("product_name"),db.from("invoice_entries").select("*").eq("invoice_id",id).order("created_at")]);if(lines.error||entries.error)throw lines.error??entries.error;
  return <><div className="mb-4 flex justify-between print:hidden"><Link className="text-accent" href={`/invoices/${id}`}>Back to invoice</Link><PrintReceipt/></div><article id="receipt" className="mx-auto max-w-3xl bg-white p-8 text-black rounded-lg space-y-5">
    <header className="flex flex-wrap justify-between gap-4"><div><h1 className="text-2xl font-bold">{i.business_name}</h1><p>{i.store_name}</p></div><div><h2 className="text-xl font-semibold">{i.state==="DRAFT"?"Draft invoice":Number(i.paid)>0?"Invoice & payment receipt":"Invoice"}</h2><p className="text-xs break-all">{i.reference}</p></div></header>
    <div className="grid gap-2 sm:grid-cols-2"><p>Customer: {i.customer_name}</p><p>Salesperson: {i.salesperson}</p><p>Issued: {i.issued_at?dateTime(i.issued_at):"Draft"}</p><p>Due: {dateOnly(i.due_date)}</p><p>Status: {i.status.replaceAll("_"," ")}</p><p>Goods: {i.goods_issued_at?`Released ${dateTime(i.goods_issued_at)}`:"Awaiting collection"}</p></div>
    <table className="w-full text-sm"><thead className="border-b border-black"><tr><th className="py-2 text-left">Item</th><th>Qty</th><th className="text-right">Unit price</th><th className="text-right">Amount</th></tr></thead><tbody>{lines.data?.map(l=><tr key={l.id} className="border-b border-gray-200"><td className="py-3">{l.product_name}</td><td className="text-center">{l.quantity}</td><td className="text-right">{money(l.unit_price,i.currency)}</td><td className="text-right">{money(l.line_total,i.currency)}</td></tr>)}</tbody></table>
    <div className="text-right space-y-1"><p>Subtotal: {money(i.subtotal,i.currency)}</p><p>Discount: {money(i.discount,i.currency)}</p><p>Tax ({i.tax_percent}%): {money(i.tax_amount,i.currency)}</p><p className="font-bold text-xl">Invoice total: {money(i.total,i.currency)}</p><p>Debit notes: {money(i.debits,i.currency)} · Credit notes: {money(i.credits,i.currency)}</p><p>Received: {money(i.paid,i.currency)}</p><p className="font-bold">Outstanding: {money(i.outstanding,i.currency)}</p></div>
    <section><h3 className="font-semibold">Payments and adjustments</h3>{entries.data?.filter(e=>e.kind!=="ISSUE").map(e=><div key={e.id} className="py-2 border-b border-gray-200 text-xs"><p>{dateTime(e.created_at)} · {e.kind.replaceAll("_"," ")} · {money(e.amount,i.currency)} · {e.method?.replace("_","/")}</p><p>{e.reference} {e.payment_reference} {e.reason}</p></div>)}</section>
    {i.note&&<p>{i.note}</p>}<p className="text-xs">Keep this document for queries or returns.</p>
  </article></>;
}
