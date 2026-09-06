"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useOffline } from "@/lib/offline/offline-context";
import { friendlyError } from "@/lib/format";
export function useBillingAction() {
  const { online }=useOffline(); const [busy,setBusy]=useState(false); const ids=useRef(new Map<string,string>());
  const router=useRouter(); const cache=useQueryClient();
  function request(payload: unknown) { const key=JSON.stringify(payload); if(!ids.current.has(key)) ids.current.set(key,crypto.randomUUID()); return ids.current.get(key)!; }
  async function run(action:()=>PromiseLike<{error:{message:string}|null}>,message:string,onSuccess?:()=>void) {
    if(!online||busy) return;
    setBusy(true);
    try { const {error}=await action(); if(error) {toast.error(friendlyError(error.message));return;} ids.current.clear(); toast.success(message); onSuccess?.(); router.refresh(); await cache.invalidateQueries({queryKey:["billing"]}).catch(()=>toast.error("Saved successfully. Refresh to see the latest records.")); }
    catch {toast.error("Couldn't confirm the result. Reconnect and retry with the same details.");}
    finally {setBusy(false);}
  }
  return {online,busy,request,run};
}
