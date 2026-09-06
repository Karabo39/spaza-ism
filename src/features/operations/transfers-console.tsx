"use client";
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useStore } from "@/lib/store-context";
import { useOffline } from "@/lib/offline/offline-context";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { LocationProductPicker } from "./product-picker";
import { dateTime, friendlyError, qty } from "@/lib/format";
import type { ProductStock, TransferStatus } from "@/lib/db/database.types";

type Line = { source_product_id: string; destination_product_id: string; source_name: string; destination_name: string; quantity: number };
const ACTIONS: Partial<Record<TransferStatus, { action: string; label: string }>> = {
  DRAFT: { action: "submit", label: "Submit" }, SUBMITTED: { action: "dispatch", label: "Dispatch" }, DISPATCHED: { action: "receive", label: "Receive & complete" },
};
export function TransfersConsole({ receiving = false }: { receiving?: boolean }) {
  const { store, stores } = useStore();
  const { online } = useOffline();
  const qc = useQueryClient();
  const [source, setSource] = React.useState(store.id);
  const [destination, setDestination] = React.useState("");
  const [src, setSrc] = React.useState<ProductStock | null>(null);
  const [dst, setDst] = React.useState<ProductStock | null>(null);
  const [quantity, setQuantity] = React.useState(1);
  const [lines, setLines] = React.useState<Line[]>([]);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState(receiving ? "DISPATCHED" : "all");
  const [filterSource, setFilterSource] = React.useState("");
  const [filterDestination, setFilterDestination] = React.useState("");
  const [cancelId, setCancelId] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("");
  const request = React.useRef<string | null>(null);
  const locations = stores.filter((s) => s.businessId === store.businessId);
  const { data, error, isLoading } = useQuery({
    queryKey: ["transfers", store.businessId, status, filterSource, filterDestination], enabled: online,
    queryFn: async () => {
      let query = createClient().from("stock_transfers").select("*").eq("business_id", store.businessId).order("created_at", { ascending: false }).limit(200);
      if (status !== "all") query = query.eq("status", status as TransferStatus);
      if (filterSource) query = query.eq("source_id", filterSource);
      if (filterDestination) query = query.eq("destination_id", filterDestination);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
  async function refresh() {
    await qc.invalidateQueries({ queryKey: ["transfers"] });
    await qc.invalidateQueries({ queryKey: ["operation-products"] });
    await qc.invalidateQueries({ queryKey: ["location-overview"] });
  }
  function addLine() {
    if (!src || !dst || !Number.isFinite(quantity) || quantity <= 0) return;
    if (src.unit !== dst.unit || src.track_expiry !== dst.track_expiry) { toast.error("Choose matching units and expiry tracking at both locations."); return; }
    if (lines.some((l) => l.source_product_id === src.id && l.destination_product_id === dst.id)) { toast.error("That product pair is already in the transfer."); return; }
    request.current = null;
    setLines([...lines, { source_product_id: src.id, destination_product_id: dst.id, source_name: src.name, destination_name: dst.name, quantity }]);
    setSrc(null); setDst(null); setQuantity(1);
  }
  async function create() {
    if (!online || busy || !lines.length) return;
    setBusy(true); request.current ??= crypto.randomUUID();
    try {
      const { error } = await createClient().rpc("create_stock_transfer", {
        p_source: source, p_destination: destination, p_note: note, p_request: request.current,
        p_items: lines.map(({ source_product_id, destination_product_id, quantity }) => ({ source_product_id, destination_product_id, quantity })),
      });
      if (error) throw error;
      toast.success("Draft transfer created. Submit when ready."); setLines([]); setNote(""); request.current = null; await refresh();
    } catch (e) { toast.error(friendlyError((e as Error).message)); } finally { setBusy(false); }
  }
  async function process(id: string, action: string) {
    if (!online || busy) return;
    setBusy(true);
    try {
      const { error } = await createClient().rpc("process_stock_transfer", { p_transfer: id, p_action: action, ...(action === "cancel" ? { p_reason: reason } : {}) });
      if (error) throw error;
      toast.success("Transfer updated"); setCancelId(null); setReason(""); await refresh();
    } catch (e) { toast.error(friendlyError((e as Error).message)); } finally { setBusy(false); }
  }
  const locationName = (id: string) => locations.find((s) => s.id === id)?.name ?? "Location";
  const locationOptions = locations.map((s) => <option value={s.id} key={s.id}>{s.name} · {s.locationType}</option>);
  return <div className="space-y-6">
    {!online ? <p role="status" className="rounded-md border border-border p-4 text-sm">Transfers require a connection. Reconnect to create, dispatch or receive stock.</p> : null}
    {!receiving ? <Card><CardHeader><CardTitle>Create stock transfer</CardTitle></CardHeader><CardContent className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div><Label htmlFor="transfer-source">Source location</Label><select id="transfer-source" className="h-10 w-full rounded-md border border-border bg-input px-2 text-sm" value={source} disabled={busy || !!lines.length} onChange={(e) => { setSource(e.target.value); setSrc(null); request.current = null; }}>{locationOptions}</select></div>
        <div><Label htmlFor="transfer-destination">Destination location</Label><select id="transfer-destination" className="h-10 w-full rounded-md border border-border bg-input px-2 text-sm" value={destination} disabled={busy || !!lines.length} onChange={(e) => { setDestination(e.target.value); setDst(null); request.current = null; }}><option value="">Choose destination</option>{locationOptions}</select></div>
        <LocationProductPicker key={`src-${source}`} location={source} label="Source product" value={src} onChange={setSrc} />
        <LocationProductPicker key={`dst-${destination}`} location={destination} label="Matching destination product" value={dst} onChange={setDst} />
      </div>
      <p className="text-xs text-muted">Choose the same physical item at both locations. Create its destination product in Products first if needed. Products must use matching units and expiry tracking.</p>
      <div className="flex items-end gap-3"><div><Label htmlFor="transfer-quantity">Quantity</Label><Input id="transfer-quantity" type="number" min="0.001" step="1" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} /></div><Button variant="secondary" disabled={!online || busy || !src || !dst || source === destination} onClick={addLine}>Add item</Button></div>
      {lines.length ? <Table><THead><TR><TH>From product</TH><TH>To product</TH><TH>Quantity</TH><TH /></TR></THead><TBody>{lines.map((l, i) => <TR key={i}><TD>{l.source_name}</TD><TD>{l.destination_name}</TD><TD>{qty(l.quantity)}</TD><TD><Button variant="ghost" size="sm" disabled={busy} onClick={() => { setLines(lines.filter((_, index) => index !== i)); request.current = null; }}>Remove</Button></TD></TR>)}</TBody></Table> : null}
      <div><Label htmlFor="transfer-note">Reference or note</Label><Input id="transfer-note" value={note} disabled={busy} onChange={(e) => { setNote(e.target.value); request.current = null; }} /></div>
      <Button onClick={create} disabled={!online || !lines.length || source === destination} loading={busy}>Save draft transfer</Button>
    </CardContent></Card> : null}
    <Card><CardHeader><CardTitle>{receiving ? "Receive dispatched stock" : "Transfer history"}</CardTitle></CardHeader><CardContent className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <div><Label htmlFor="transfer-status">Status</Label><select id="transfer-status" className="h-10 w-full rounded-md border border-border bg-input px-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All statuses</option>{["DRAFT","SUBMITTED","DISPATCHED","RECEIVED","CANCELLED"].map((s) => <option key={s}>{s}</option>)}</select></div>
        <div><Label htmlFor="filter-source">From location</Label><select id="filter-source" className="h-10 w-full rounded-md border border-border bg-input px-2 text-sm" value={filterSource} onChange={(e) => setFilterSource(e.target.value)}><option value="">All sources</option>{locationOptions}</select></div>
        <div><Label htmlFor="filter-destination">To location</Label><select id="filter-destination" className="h-10 w-full rounded-md border border-border bg-input px-2 text-sm" value={filterDestination} onChange={(e) => setFilterDestination(e.target.value)}><option value="">All destinations</option>{locationOptions}</select></div>
      </div>
      {error ? <p role="alert" className="text-danger">{friendlyError(error.message)}</p> : isLoading ? <p>Loading…</p> : (data ?? []).length === 0 ? <p className="text-sm text-muted">No matching transfers.</p> : (data ?? []).map((t) => <div key={t.id} className="rounded-md border border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-medium">{locationName(t.source_id)} → {locationName(t.destination_id)}</p><p className="break-all text-xs text-muted">{t.reference} · {dateTime(t.created_at)}</p><p className="mt-1 text-xs">{t.status}</p></div><div className="flex flex-wrap gap-2">
          {ACTIONS[t.status] ? <Button size="sm" disabled={!online || busy} onClick={() => process(t.id, ACTIONS[t.status]!.action)}>{ACTIONS[t.status]!.label}</Button> : null}
          {!["RECEIVED","CANCELLED"].includes(t.status) ? <Button size="sm" variant="ghost" disabled={!online || busy} onClick={() => { setCancelId(t.id); setReason(""); }}>Cancel transfer</Button> : null}
        </div></div>
        <TransferLines id={t.id} />
        {t.cancellation_reason ? <p className="text-sm text-muted">Cancelled: {t.cancellation_reason}</p> : null}
        {cancelId === t.id ? <form className="mt-3 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void process(t.id, "cancel"); }}><Input aria-label="Cancellation reason" placeholder="Reason for cancellation" required value={reason} onChange={(e) => setReason(e.target.value)} /><Button type="submit" variant="danger" disabled={!reason.trim() || busy}>Confirm cancellation</Button><Button type="button" variant="ghost" onClick={() => setCancelId(null)}>Keep transfer</Button></form> : null}
      </div>)}
      <p className="text-xs text-muted">Latest 200 matching transfers. Submitted stock is checked again at dispatch. Destination stock increases only when received.</p>
    </CardContent></Card>
  </div>;
}
function TransferLines({ id }: { id: string }) {
  const [open, setOpen] = React.useState(false);
  const { data, error } = useQuery({ queryKey: ["transfer-lines", id], enabled: open, queryFn: async () => {
    const { data, error } = await createClient().from("stock_transfer_items").select("*").eq("transfer_id", id);
    if (error) throw error; return data;
  } });
  return <details className="mt-3 text-sm" onToggle={(e) => setOpen(e.currentTarget.open)}><summary className="cursor-pointer text-muted">Items</summary>{error ? <p role="alert">Could not load items.</p> : <ul className="mt-2 space-y-1">{data?.map((i) => <li key={i.id}>{qty(i.quantity)} × {i.source_name} → {i.destination_name}</li>)}</ul>}</details>;
}
