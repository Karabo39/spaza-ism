"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PackageSearch, SlidersHorizontal } from "lucide-react";
import { ScanInput } from "@/features/scan/scan-input";
import { ProductSearchDialog } from "@/features/scan/product-search-dialog";
import { lookupByCode } from "@/features/scan/lookup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store-context";
import { qty, friendlyError } from "@/lib/format";
import type { ProductStock } from "@/lib/db/database.types";

const REASONS = [
  { v: "DAMAGED", l: "Damaged" },
  { v: "EXPIRED", l: "Expired" },
  { v: "MISSING", l: "Missing / lost" },
  { v: "THEFT", l: "Theft" },
  { v: "STOCK_COUNT_CORRECTION", l: "Count correction" },
  { v: "OTHER", l: "Other" },
];

export function AdjustConsole() {
  const router = useRouter();
  const { store } = useStore();
  const [product, setProduct] = React.useState<ProductStock | null>(null);
  const [newQty, setNewQty] = React.useState("");
  const [reason, setReason] = React.useState("DAMAGED");
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);

  async function onScan(code: string) {
    setBusy(true);
    const hit = await lookupByCode(store.id, code);
    setBusy(false);
    if ("product" in hit) { setProduct(hit.product); setNewQty(String(hit.product.quantity)); }
    else toast.error(`No product for "${code}"`);
  }

  function pick(p: ProductStock) { setProduct(p); setNewQty(String(p.quantity)); }

  async function submit() {
    if (!product) return;
    const nq = Number(newQty);
    if (Number.isNaN(nq) || nq < 0) { toast.error("Enter a valid new quantity"); return; }
    if (nq === Number(product.quantity)) { toast.error("New quantity matches current — no change"); return; }
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("adjust_stock", {
      p_store: store.id, p_product: product.id, p_new_qty: nq, p_reason: reason, p_note: note.trim() || undefined,
    });
    setBusy(false);
    if (error) { toast.error(friendlyError(error.message)); return; }
    toast.success(`${product.name} adjusted to ${qty(nq)}`);
    setProduct(null); setNewQty(""); setNote("");
    router.refresh();
  }

  const delta = product ? Number(newQty || 0) - Number(product.quantity) : 0;

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <ScanInput onScan={onScan} busy={busy} placeholder="Scan the product to adjust" />
      <div className="flex justify-end">
        <Button variant="secondary" size="sm" onClick={() => setSearchOpen(true)}><PackageSearch className="size-4" /> Find product</Button>
      </div>

      {product ? (
        <div className="space-y-4 rounded-lg border border-border bg-surface p-5">
          <div>
            <h2 className="text-lg font-semibold">{product.name}</h2>
            <p className="text-sm text-muted">Current stock: <span className="tabular-nums text-foreground">{qty(product.quantity)} {product.unit}</span></p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="nq">New counted quantity</Label>
              <Input id="nq" type="number" step="0.001" min="0" autoFocus value={newQty} onChange={(e) => setNewQty(e.target.value)} />
            </div>
            <div>
              <Label>Change</Label>
              <div className={`flex h-10 items-center rounded-md border border-border bg-surface-2 px-3 text-sm tabular-nums ${delta > 0 ? "text-success" : delta < 0 ? "text-danger" : "text-muted"}`}>
                {delta > 0 ? "+" : ""}{qty(delta)}
              </div>
            </div>
          </div>
          <div>
            <Label htmlFor="reason">Reason</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger id="reason"><SelectValue /></SelectTrigger>
              <SelectContent>{REASONS.map((r) => <SelectItem key={r.v} value={r.v}>{r.l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="note">Note (optional)</Label>
            <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Explain the adjustment" />
          </div>
          <Button className="w-full" loading={busy} onClick={submit}>
            <SlidersHorizontal className="size-4" /> Apply adjustment
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-surface/50 py-16 text-center">
          <SlidersHorizontal className="size-8 text-muted" />
          <p className="text-sm text-muted">Scan or find a product to correct its quantity.</p>
        </div>
      )}

      <ProductSearchDialog open={searchOpen} onOpenChange={setSearchOpen} onPick={pick} showPrice={false} />
    </div>
  );
}
