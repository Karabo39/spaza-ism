"use client";
import {useState} from "react";
import {useQuery} from "@tanstack/react-query";
import {createClient} from "@/lib/supabase/client";
import {useStore} from "@/lib/store-context";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {money} from "@/lib/format";
import {useBillingAction} from "./use-billing-action";
export function AllocateCredit({invoiceId,customerId}:{invoiceId:string;customerId:string}){
  const {store,currency}=useStore();const {online,busy,request,run}=useBillingAction();const [source,setSource]=useState("");const [amount,setAmount]=useState("");
  const {data,error}=useQuery({queryKey:["billing","available-returns",store.id,customerId],queryFn:async()=>{const {data,error}=await createClient().from("goods_returns").select("*").eq("store_id",store.id).eq("status","APPROVED").or(`customer_id.eq.${customerId},customer_id.is.null`).order("created_at",{ascending:false}).limit(100);if(error)throw error;return data?.filter(r=>r.invoice_id!==invoiceId);}});
  return <section className="rounded-lg border border-border bg-surface p-5 space-y-3"><h2 className="font-semibold">Use approved return credit</h2><p className="text-sm text-muted">Allocate unused return credit to this invoice. Earlier refunds or allocations reduce the credit available.</p>{error&&<p role="alert">Could not load return credits.</p>}<Label htmlFor="credit-return">Approved return</Label><select id="credit-return" className="h-10 w-full rounded border border-border bg-input px-2" value={source} onChange={e=>setSource(e.target.value)}><option value="">Select return reference</option>{data?.map(r=><option key={r.id} value={r.id}>{r.reference} · original value {money(r.amount,currency)}</option>)}</select><Label htmlFor="credit-allocation-amount">Amount to allocate</Label><Input id="credit-allocation-amount" type="number" min="0.01" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/><Button loading={busy} disabled={!online||!source||Number(amount)<=0} onClick={()=>{const payload={p_return:source,p_invoice:invoiceId,p_amount:Number(amount)};void run(()=>createClient().rpc("allocate_return_credit",{...payload,p_request:request(payload)}),"Store credit allocated",()=>setAmount(""));}}>Allocate store credit</Button></section>;
}
