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
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store-context";
import { qty, friendlyError } from "@/lib/format";
import type { ProductStock } from "@/lib/db/database.types";
import { useOffline } from "@/lib/offline/offline-context";
import { useQueryClient } from "@tanstack/react-query";

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
  const { online } = useOffline();
  const cache = useQueryClient();
  const [expiry, setExpiry] = React.useState("");
  const request = React.useRef<{ key: string; id: string } | null>(null);

  async function onScan(code: string) {
    setBusy(true);
    const hit = await lookupByCode(store.id, code);
    setBusy(false);
    if ("product" in hit) {
      setProduct(hit.product);
      setNewQty(String(hit.product.quantity));
    } else toast.error(`No product for "${code}"`);
  }

  function pick(p: ProductStock) {
    setProduct(p);
    setNewQty(String(p.quantity));
  }

  async function submit() {
    if (!product || !online || busy) return;
    const nq = Number(newQty);
    if (!newQty.trim() || !Number.isFinite(nq) || nq < 0) {
      toast.error("Enter a valid new quantity");
      return;
    }
    if (nq === Number(product.quantity)) {
      toast.error("New quantity matches current — no change");
      return;
    }
    setBusy(true);
    const payload = {
      p_store: store.id,
      p_product: product.id,
      p_new_qty: nq,
      p_reason: reason,
      p_note: note.trim() || undefined,
      p_expected: Number(product.quantity),
      ...(expiry ? { p_expiry: expiry } : {}),
    };
    const key = JSON.stringify(payload);
    if (request.current?.key !== key)
      request.current = { key, id: crypto.randomUUID() };
    try {
      const { error } = await createClient().rpc("adjust_stock", {
        ...payload,
        p_request: request.current.id,
      });
      if (error) throw error;
      toast.success(`${product.name} adjusted to ${qty(nq)}`);
      setProduct(null);
      setNewQty("");
      setNote("");
      setExpiry("");
      request.current = null;
      router.refresh();
      await cache.invalidateQueries();
    } catch (error) {
      toast.error(friendlyError((error as Error).message));
    } finally {
      setBusy(false);
    }
  }

  async function refreshStock() {
    if (!online) return;
    setBusy(true);
    try {
      if (product) {
        const { data, error } = await createClient()
          .from("v_product_stock")
          .select("*")
          .eq("id", product.id)
          .eq("store_id", store.id)
          .single();
        if (error) throw error;
        pick(data as ProductStock);
      }
      await cache.invalidateQueries();
      router.refresh();
      toast.success(
        "Stock refreshed from current records. Enter the physical count again.",
      );
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const delta = product ? Number(newQty || 0) - Number(product.quantity) : 0;

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <p className="text-sm text-muted">
        Adjustments require a connection. Refresh stock before recounting if
        another transaction changed it.
      </p>
      <Button
        variant="secondary"
        disabled={!online || busy}
        onClick={refreshStock}
      >
        Refresh stock from records
      </Button>
      <ScanInput
        onScan={onScan}
        busy={busy}
        placeholder="Scan the product to adjust"
      />
      <div className="flex justify-end">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setSearchOpen(true)}
        >
          <PackageSearch className="size-4" /> Find product
        </Button>
      </div>

      {product ? (
        <div className="space-y-4 rounded-lg border border-border bg-surface p-5">
          <div>
            <h2 className="text-lg font-semibold">{product.name}</h2>
            <p className="text-sm text-muted">
              Current stock:{" "}
              <span className="tabular-nums text-foreground">
                {qty(product.quantity)} {product.unit}
              </span>
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="nq">New counted quantity</Label>
              <Input
                id="nq"
                type="number"
                step="0.001"
                min="0"
                autoFocus
                value={newQty}
                onChange={(e) => setNewQty(e.target.value)}
              />
            </div>
            <div>
              <Label>Change</Label>
              <div
                className={`flex h-10 items-center rounded-md border border-border bg-surface-2 px-3 text-sm tabular-nums ${delta > 0 ? "text-success" : delta < 0 ? "text-danger" : "text-muted"}`}
              >
                {delta > 0 ? "+" : ""}
                {qty(delta)}
              </div>
            </div>
          </div>
          <div>
            <Label htmlFor="reason">Reason</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger id="reason">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REASONS.map((r) => (
                  <SelectItem key={r.v} value={r.v}>
                    {r.l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="note">Note (optional)</Label>
            <Input
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Explain the adjustment"
            />
          </div>
          {product.track_expiry && (
            <div>
              <Label htmlFor="adjust-expiry">
                Expiry date{" "}
                {delta > 0
                  ? "(required for added stock)"
                  : "(optional: limit removal to this batch date)"}
              </Label>
              <Input
                id="adjust-expiry"
                type="date"
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted">
                Without a date, removals use earliest expiry first. Expired
                adjustments only remove already expired batches.
              </p>
            </div>
          )}
          <Button
            className="w-full"
            loading={busy}
            disabled={!online || (product.track_expiry && delta > 0 && !expiry)}
            onClick={submit}
          >
            <SlidersHorizontal className="size-4" /> Apply adjustment
          </Button>
          <Button
            variant="secondary"
            className="w-full"
            disabled={busy}
            onClick={() => {
              setProduct(null);
              setNewQty("");
              setNote("");
              setExpiry("");
              request.current = null;
            }}
          >
            Cancel adjustment
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-surface/50 py-16 text-center">
          <SlidersHorizontal className="size-8 text-muted" />
          <p className="text-sm text-muted">
            Scan or find a product to correct its quantity.
          </p>
        </div>
      )}

      <ProductSearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onPick={pick}
        showPrice={false}
      />
    </div>
  );
}
