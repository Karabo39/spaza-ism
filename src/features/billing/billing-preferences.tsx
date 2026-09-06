"use client";
import {useState} from "react";
import {createClient} from "@/lib/supabase/client";
import {useStore} from "@/lib/store-context";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {useBillingAction} from "./use-billing-action";
export function BillingPreferences({tax,returnApproval}:{tax:number;returnApproval:boolean}){
  const {store,can}=useStore();const {online,busy,run}=useBillingAction();const [rate,setRate]=useState(tax);const [approval,setApproval]=useState(returnApproval);
  if(!can("owner"))return null;
  return <section className="mt-6 max-w-xl space-y-3 rounded-lg border border-border bg-surface p-5"><h2 className="font-semibold">Invoicing and returns</h2><p className="text-sm text-muted">Tax is added after discounts on new invoices. Issued invoices keep their original settings.</p><Label htmlFor="billing-tax">Default tax (%)</Label><Input id="billing-tax" type="number" min="0" max="100" step="0.01" value={rate} onChange={e=>setRate(Number(e.target.value))}/><label className="flex gap-2 text-sm"><input type="checkbox" checked={approval} onChange={e=>setApproval(e.target.checked)}/>Require manager approval before a return changes stock or credit</label><Button loading={busy} disabled={!online||!Number.isFinite(rate)||rate<0||rate>100} onClick={()=>run(()=>createClient().rpc("set_billing_settings",{p_business:store.businessId,p_tax:rate,p_return_approval:approval}),"Billing settings saved")}>Save billing settings</Button></section>;
}
