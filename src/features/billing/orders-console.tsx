"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table,THead,TBody,TR,TH,TD } from "@/components/ui/table";
import { CustomerPicker } from "@/features/credit/customer-picker";
import { LocationProductPicker } from "@/features/operations/product-picker";
import { useBillingAction } from "./use-billing-action";
import { money,dateTime } from "@/lib/format";
import type { CreditCustomer,ProductStock,SalesOrder } from "@/lib/db/database.types";
type Line={product_id:string;name:string;quantity:number;unit_price:number};
export function OrdersConsole() {
  const {store,currency}=useStore(); const router=useRouter(); const {online,busy,request,run}=useBillingAction();
  const [customer,setCustomer]=useState<CreditCustomer|null>(null); const [pickCustomer,setPickCustomer]=useState(false);
  const [product,setProduct]=useState<ProductStock|null>(null); const [quantity,setQuantity]=useState(1); const [lines,setLines]=useState<Line[]>([]); const [note,setNote]=useState("");
  const [selected,setSelected]=useState<SalesOrder|null>(null); const [due,setDue]=useState(new Date().toISOString().slice(0,10)); const [terms,setTerms]=useState("CASH"); const [discount,setDiscount]=useState(0); const [reason,setReason]=useState("");
  const {data:orders,error}=useQuery({queryKey:["billing","orders",store.id],queryFn:async()=>{const {data,error}=await createClient().from("sales_orders").select("*").eq("store_id",store.id).order("created_at",{ascending:false}).limit(200);if(error)throw error;return data;}});
  const {data:items}=useQuery({queryKey:["billing","order-items",selected?.id],enabled:!!selected,queryFn:async()=>{const {data,error}=await createClient().from("sales_order_items").select("*").eq("order_id",selected!.id);if(error)throw error;return data;}});
  const current=orders?.find(o=>o.id===selected?.id)??selected;
  function add() {if(!product||quantity<=0||!Number.isFinite(quantity))return;setLines(old=>old.some(l=>l.product_id===product.id)?old.map(l=>l.product_id===product.id?{...l,quantity:l.quantity+quantity}:l):[...old,{product_id:product.id,name:product.name,quantity,unit_price:Number(product.selling_price)}]);setProduct(null);setQuantity(1);}
  async function createInvoice() {if(!current)return;await run(async()=>{const res=await createClient().rpc("create_sales_invoice",{p_order:current.id,p_due:due,p_terms:terms,p_discount:discount});if(res.data)router.push(`/invoices/${res.data}`);return res;},"Invoice draft created");}
  return <div className="space-y-6">
    {!online&&<p className="text-warning">Orders and invoices require a connection.</p>}
    {store.locationType!=="warehouse"&&<section className="space-y-4 rounded-lg border border-border bg-surface p-5">
      <div className="flex justify-between"><h2 className="font-semibold">New order</h2><Button variant="secondary" onClick={()=>setPickCustomer(true)}>{customer?.name??"Choose customer"}</Button></div>
      <div className="grid gap-3 md:grid-cols-[1fr_8rem_auto]"><LocationProductPicker location={store.id} label="Order product" value={product} onChange={setProduct}/><div><Label htmlFor="order-quantity">Quantity</Label><Input id="order-quantity" type="number" min="0.001" step="0.001" value={quantity} onChange={e=>setQuantity(Number(e.target.value))}/></div><Button className="self-end" variant="secondary" onClick={add} disabled={!product||quantity<=0}>Add item</Button></div>
      {lines.map(l=><div key={l.product_id} className="flex items-center justify-between border-b border-border py-2 text-sm"><span>{l.quantity} × {l.name} · {money(l.quantity*l.unit_price,currency)}</span><Button variant="ghost" onClick={()=>setLines(old=>old.filter(x=>x.product_id!==l.product_id))}>Remove</Button></div>)}
      <Label htmlFor="order-note">Order note</Label><Input id="order-note" value={note} onChange={e=>setNote(e.target.value)}/>
      <Button loading={busy} disabled={!online||!customer||!lines.length} onClick={()=>{const payload={p_store:store.id,p_customer:customer!.customer_id,p_items:lines.map(({product_id,quantity,unit_price})=>({product_id,quantity,unit_price})),p_note:note};void run(()=>createClient().rpc("create_sales_order",{...payload,p_request:request(payload)}),"Order draft saved",()=>{setLines([]);setCustomer(null);setNote("");});}}>Save order draft</Button>
    </section>}
    <div className="flex justify-between"><h2 className="font-semibold">Recent orders</h2><Link className="text-accent" href="/invoices">View invoices</Link></div>
    {error&&<p role="alert" className="text-danger">Could not load orders.</p>}
    {orders?.length===200&&<p className="text-sm text-muted">Latest 200 orders.</p>}
    <Table><THead><TR><TH>Reference</TH><TH>Customer</TH><TH>Status</TH><TH>Created</TH></TR></THead><TBody>{orders?.map(o=><TR key={o.id}><TD><button className="text-accent text-left" onClick={()=>setSelected(o)}>{o.reference}</button></TD><TD>{o.customer_name}</TD><TD>{o.status}</TD><TD>{dateTime(o.created_at)}</TD></TR>)}</TBody></Table>
    {current&&<section className="space-y-4 rounded-lg border border-border bg-surface p-5"><h2 className="font-semibold">{current.reference} · {current.status}</h2><p>{current.customer_name} · {current.note}</p>
      {items?.map(l=><p key={l.id} className="text-sm">{l.quantity} × {l.product_name} — {money(l.line_total,currency)}</p>)}
      {current.status==="DRAFT"&&<Button loading={busy} disabled={!online} onClick={()=>run(()=>createClient().rpc("process_sales_order",{p_order:current.id,p_action:"confirm"}),"Order confirmed")}>Confirm order</Button>}
      {current.status==="CONFIRMED"&&<div className="grid gap-3 sm:grid-cols-3"><div><Label htmlFor="invoice-due">Payment due</Label><Input id="invoice-due" type="date" value={due} onChange={e=>setDue(e.target.value)}/></div><div><Label htmlFor="invoice-terms">Payment terms</Label><select id="invoice-terms" className="h-10 w-full rounded border border-border bg-input px-2" value={terms} onChange={e=>setTerms(e.target.value)}><option value="CASH">Cash before collection</option><option value="CARD_EFT">Card/EFT before collection</option><option value="CREDIT">Customer credit account</option></select></div><div><Label htmlFor="invoice-discount">Discount amount</Label><Input id="invoice-discount" type="number" min="0" step="0.01" value={discount} onChange={e=>setDiscount(Number(e.target.value))}/></div><Button loading={busy} disabled={!online||!due} onClick={createInvoice}>Create invoice</Button></div>}
      {current.status!=="CANCELLED"&&<div className="flex gap-2"><Input aria-label="Order cancellation reason" placeholder="Cancellation reason" value={reason} onChange={e=>setReason(e.target.value)}/><Button variant="secondary" disabled={!online||busy||!reason.trim()} onClick={()=>run(()=>createClient().rpc("process_sales_order",{p_order:current.id,p_action:"cancel",p_reason:reason}),"Order cancelled")}>Cancel order</Button></div>}
    </section>}
    <CustomerPicker open={pickCustomer} onOpenChange={setPickCustomer} onSelect={setCustomer}/>
  </div>;
}
