"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useStore } from "@/lib/store-context";
import { useOffline } from "@/lib/offline/offline-context";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { friendlyError } from "@/lib/format";
type Result = {
  created: number;
  updated: number;
  matched: number;
  skipped: number;
  preview: boolean;
  errors: { name: string; error: string }[];
};
const reasons: Record<string, string> = {
  CONFLICTING_PRODUCT_IDENTIFIERS:
    "SKU, barcode or saved link refers to different products.",
  PRODUCT_STRUCTURE_MISMATCH:
    "Unit, expiry tracking or bulk configuration differs. Review these products first.",
  PRODUCT_INACTIVE: "The matching store product is inactive.",
  CURRENCY_MISMATCH:
    "This new product needs a price in the store’s currency. Create it in the store before syncing.",
  CONFLICTING_PRODUCT_LINK:
    "This store product is already linked to another warehouse product.",
  INVALID_PRODUCT_ROW:
    "The product could not be copied. Review its configuration.",
};
export function SyncStoreProducts() {
  const { store, stores, can, canModule } = useStore();
  const { online } = useOffline();
  const router = useRouter();
  const cache = useQueryClient();
  const [open, setOpen] = useState(false),
    [warehouse, setWarehouse] = useState("");
  const [result, setResult] = useState<Result | null>(null),
    [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const warehouses = stores.filter(
    (s) =>
      s.businessId === store.businessId &&
      s.locationType === "warehouse" &&
      s.modules.warehouse,
  );
  if (
    store.locationType !== "store" ||
    !can("manager") ||
    !canModule("products") ||
    !warehouses.length
  )
    return null;
  async function run(preview: boolean) {
    if (!online || !warehouse || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const { data, error } = await createClient().rpc("sync_store_products", {
        p_store: store.id,
        p_warehouse: warehouse,
        p_preview: preview,
      });
      if (error) throw error;
      const next = data as unknown as Result;
      setResult(next);
      if (!preview) {
        if (next.skipped)
          toast.warning(
            `Products synced with ${next.skipped} conflicts. Review the list below.`,
          );
        else toast.success("Products synced successfully.");
        await cache.invalidateQueries({ queryKey: ["store-setup"] });
        await Promise.all(
          ["product-picker", "operation-products", "order-product-search"].map(
            key => cache.invalidateQueries({ queryKey: [key, store.id] }),
          ),
        );
        router.refresh();
      }
    } catch (e) {
      setError(friendlyError((e as Error).message));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        size="sm"
        disabled={!online}
        onClick={() => {
          setWarehouse(warehouses[0].id);
          setResult(null);
          setError("");
          setOpen(true);
        }}
      >
        Sync Products
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sync products into {store.name}</DialogTitle>
            <DialogDescription>
              Copy products from a warehouse. Existing store cost and selling
              prices stay unchanged. Stock quantities, batches and movements
              stay unchanged.
            </DialogDescription>
          </DialogHeader>
          <label className="text-sm">
            Warehouse
            <select
              className="mt-2 h-11 w-full rounded-md border border-border bg-input px-3"
              value={warehouse}
              disabled={busy}
              onChange={(e) => {
                setWarehouse(e.target.value);
                setResult(null);
                setError("");
              }}
            >
              {warehouses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.currency})
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-muted">
            New products use warehouse prices only when currencies match.
            Existing store-only products and barcodes are kept. Product names
            and descriptions are refreshed; conflicting identifiers or stock
            configurations are skipped.
          </p>
          {error && (
            <p role="alert" className="text-danger">
              {error}
            </p>
          )}
          {result && (
            <div role="status" className="space-y-2 text-sm">
              <p>
                {result.preview ? "Preview" : "Completed"}: {result.created} new
                · {result.updated} updated · {result.matched} unchanged ·{" "}
                {result.skipped} skipped
              </p>
              {result.errors.length > 0 && (
                <ul className="max-h-56 list-disc overflow-auto pl-5 text-warning">
                  {result.errors.map((e, i) => (
                    <li key={i}>
                      {e.name}: {reasons[e.error] ?? e.error}
                    </li>
                  ))}
                </ul>
              )}
              {result.skipped > result.errors.length && (
                <p>Showing the first {result.errors.length} conflicts.</p>
              )}
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Close
            </Button>
            <Button
              disabled={!online || busy}
              loading={busy}
              onClick={() => void run(true)}
            >
              Preview sync
            </Button>
            {result?.preview &&
              result.created + result.updated + result.matched > 0 && (
                <Button
                  disabled={!online || busy}
                  onClick={() => void run(false)}
                >
                  Sync products
                </Button>
              )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
