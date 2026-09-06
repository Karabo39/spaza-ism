"use client";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table,THead,TBody,TR,TH,TD } from "@/components/ui/table";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store-context";
import { money,dateOnly,dateTime } from "@/lib/format";
import { OverrideApproval } from "@/features/credit/override-approval";
import { ExportButton } from "@/features/reports/export-button";
import { useBillingAction } from "./use-billing-action";
import { AllocateCredit } from "./allocate-credit";
import type { InvoiceBalance,SalesInvoiceItem,InvoiceEntry } from "@/lib/db/database.types";
export function InvoiceWorkspace({invoice:i,items,entries,account}:{invoice:InvoiceBalance;items:SalesInvoiceItem[];entries:InvoiceEntry[];account:{balance:number;credit_limit:number}}){
  const {can}=useStore();const {online,busy,request,run}=useBillingAction();
  const [amount,setAmount]=useState("");const [method,setMethod]=useState("CASH");const [reference,setReference]=useState("");const [kind,setKind]=useState("PAYMENT");const [reason,setReason]=useState("");const [override,setOverride]=useState(false);const [token,setToken]=useState<string>();
  const needsApproval=i.terms==="CREDIT"&&Number(i.outstanding)>0&&Number(account.balance)>Number(account.credit_limit);
  function post(){const payload={p_invoice:i.id,p_kind:kind,p_amount:Number(amount),...(kind==="PAYMENT"?{p_method:method,p_reference:reference}:{}),p_reason:reason};void run(()=>createClient().rpc("post_invoice_entry",{...payload,p_request:request(payload)}),kind==="PAYMENT"?"Payment recorded":"Note posted",()=>{setAmount("");setReason("");setReference("");});}
  return <div className="space-y-5">
    {!online&&<p className="text-warning">Invoice actions require a connection.</p>}
    <div className="flex flex-wrap gap-3"><Link className="text-accent" href={`/invoices/${i.id}/receipt`}>Open invoice / receipt</Link><Link className="text-accent" href={`/credit/${i.customer_id}`}>Customer statement</Link>{i.goods_issued_at&&<Link className="text-accent" href={`/returns?invoice=${i.id}`}>Return goods</Link>}</div>
    <div className="grid gap-3 sm:grid-cols-4">{[["Invoice total",i.total],["Payments",i.paid],["Credit notes",i.credits],["Outstanding",i.outstanding]].map(([label,value])=><div key={label} className="rounded-lg border border-border bg-surface p-4"><p className="text-xs text-muted">{label}</p><p className="text-xl font-semibold">{money(Number(value),i.currency)}</p></div>)}</div>
    <p className="text-sm text-muted">{i.customer_name} · {i.terms.replace("_","/")} · Due {dateOnly(i.due_date)} · {i.status.replaceAll("_"," ")} · Salesperson: {i.salesperson}</p>
    <Table><THead><TR><TH>Product</TH><TH>Quantity</TH><TH>Unit price</TH><TH>Line value</TH></TR></THead><TBody>{items.map(l=><TR key={l.id}><TD>{l.product_name}</TD><TD>{l.quantity} {l.unit}</TD><TD>{money(l.unit_price,i.currency)}</TD><TD>{money(l.line_total,i.currency)}</TD></TR>)}</TBody></Table>
    <p className="text-right text-sm">Subtotal {money(i.subtotal,i.currency)} − Discount {money(i.discount,i.currency)} + Tax ({i.tax_percent}%) {money(i.tax_amount,i.currency)}</p>
    {i.note&&<p>{i.note}</p>}
    {i.state==="DRAFT"&&<div className="rounded-lg border border-border bg-surface p-5 space-y-3"><p className="text-sm">Issuing records the customer receivable and fixes this invoice’s prices, discounts and tax.</p><Button disabled={!online} loading={busy} onClick={()=>run(()=>createClient().rpc("issue_sales_invoice",{p_invoice:i.id}),"Invoice issued")}>Issue invoice</Button></div>}
    {i.state==="ISSUED"&&<section className="rounded-lg border border-border bg-surface p-5 space-y-3"><h2 className="font-semibold">Payment or adjustment</h2><div className="grid gap-3 sm:grid-cols-3">
      <div><Label htmlFor="entry-kind">Transaction</Label><select id="entry-kind" className="h-10 w-full rounded border border-border bg-input px-2" value={kind} onChange={e=>setKind(e.target.value)}><option value="PAYMENT">Payment received</option>{can("manager")&&<><option value="CREDIT_NOTE">Credit note</option><option value="DEBIT_NOTE">Debit note</option></>}</select></div>
      <div><Label htmlFor="entry-amount">Amount</Label><Input id="entry-amount" type="number" min="0.01" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></div>
      {kind==="PAYMENT"&&<div><Label htmlFor="entry-method">Payment method</Label><select id="entry-method" className="h-10 w-full rounded border border-border bg-input px-2" value={method} onChange={e=>setMethod(e.target.value)}><option value="CASH">Cash</option><option value="CARD_EFT">Card/EFT</option></select></div>}
    </div>{kind==="PAYMENT"?<><Label htmlFor="entry-reference">Card slip / payment reference</Label><Input id="entry-reference" value={reference} onChange={e=>setReference(e.target.value)}/><p className="text-xs text-muted">Credit terms leave the balance outstanding until money is received.</p></>:<p className="text-xs text-muted">Financial notes adjust the amount owed. Use Return goods for physical returns and refunds.</p>}
    <Label htmlFor="entry-reason">{kind==="PAYMENT"?"Note (optional)":"Reason (required)"}</Label><Input id="entry-reason" value={reason} onChange={e=>setReason(e.target.value)}/>
    <Button loading={busy} disabled={!online||Number(amount)<=0||!Number.isFinite(Number(amount))||(kind!=="PAYMENT"&&!reason.trim())} onClick={post}>{kind==="PAYMENT"?"Record payment":"Post note"}</Button></section>}
    {i.state==="ISSUED"&&!i.goods_issued_at&&<section className="rounded-lg border border-border bg-surface p-5 space-y-3"><h2 className="font-semibold">Release goods</h2><p className="text-sm">Cash and Card/EFT invoices must be paid before collection. Credit invoices use the customer’s current account limit.</p>
      {needsApproval&&(can("manager")?<label className="flex gap-2 text-sm"><input type="checkbox" checked={override} onChange={e=>setOverride(e.target.checked)}/>Approve release above the credit limit</label>:<OverrideApproval customerId={i.customer_id} amount={Number(i.outstanding)} onApproved={setToken}/>)}
      {token&&<p className="text-sm text-success">Approved. Release goods within two minutes.</p>}
      <Button loading={busy} disabled={!online||(i.terms!=="CREDIT"&&Number(i.outstanding)>0)||Number(i.credits)>0} onClick={()=>run(()=>createClient().rpc("issue_invoice_goods",{p_invoice:i.id,p_override:override,...(token?{p_override_token:token}:{})}),"Goods released")}>Release invoice goods</Button>
    </section>}
    {i.state==="ISSUED"&&Number(i.outstanding)>0&&<AllocateCredit invoiceId={i.id} customerId={i.customer_id}/>}
    {i.goods_issued_at&&<p className="text-success">Goods released on {dateTime(i.goods_issued_at)}.</p>}
    {can("manager")&&(i.state==="DRAFT"||i.state==="ISSUED")&&!i.goods_issued_at&&<div className="flex gap-3"><Input aria-label="Invoice cancellation reason" placeholder="Reason for cancellation / void" value={reason} onChange={e=>setReason(e.target.value)}/><Button variant="secondary" disabled={!online||busy||!reason.trim()} onClick={()=>run(()=>createClient().rpc("cancel_sales_invoice",{p_invoice:i.id,p_reason:reason}),"Invoice cancelled / voided")}>Cancel / void</Button></div>}
    <div className="flex justify-between"><h2 className="font-semibold">Invoice ledger</h2><ExportButton rows={entries.map(e=>({date:dateTime(e.created_at),reference:e.reference,kind:e.kind,amount:e.amount,method:e.method??"",note:e.reason??""}))} columns={[{key:"date",label:"Date"},{key:"reference",label:"Reference"},{key:"kind",label:"Type"},{key:"amount",label:"Amount"},{key:"method",label:"Method"},{key:"note",label:"Note"}]} filename={i.reference}/></div>
    <Table><THead><TR><TH>Date</TH><TH>Document</TH><TH>Type</TH><TH>Amount</TH><TH>Reference / reason</TH></TR></THead><TBody>{entries.map(e=><TR key={e.id}><TD>{dateTime(e.created_at)}</TD><TD>{e.reference}</TD><TD>{e.kind.replaceAll("_"," ")}</TD><TD>{money(e.amount,i.currency)}</TD><TD>{[e.payment_reference,e.reason].filter(Boolean).join(" · ")}</TD></TR>)}</TBody></Table>
  </div>;
}
