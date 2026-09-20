"use client";
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LocationProductPicker } from "@/features/operations/product-picker";
import { useStore } from "@/lib/store-context";
import { useOffline } from "@/lib/offline/offline-context";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/format";
import type { ProductStock } from "@/lib/db/database.types";
export function BulkProductDialog({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (p: ProductStock) => void;
}) {
  const { store } = useStore();
  const { online } = useOffline();
  const cache = useQueryClient();
  const [unit, setUnit] = useState<ProductStock | null>(null),
    [pack, setPack] = useState<ProductStock | null>(null);
  const [existing, setExisting] = useState(false),
    [name, setName] = useState(""),
    [sku, setSku] = useState(""),
    [barcode, setBarcode] = useState("");
  const [ratio, setRatio] = useState(6),
    [cost, setCost] = useState(""),
    [selling, setSelling] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const attempt = useRef<{ key: string; id: string } | null>(null);
  const lock = useRef(false);
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v && !busy) onClose();
      }}
    >
      <DialogContent>
        <DialogTitle>Set up bulk stock</DialogTitle>
        <DialogDescription>
          Link a bulk product to an existing individual item at {store.name}.
          Quantities are added only when you confirm receiving.
        </DialogDescription>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (lock.current || !online || !unit || (existing && !pack)) return;
            lock.current = true;
            setBusy(true);
            setError("");
            try {
              const db = createClient();
              let id = pack?.id;
              if (existing) {
                const { error } = await db.rpc("set_bulk_conversion", {
                  p_pack: pack!.id,
                  p_unit: unit.id,
                  p_ratio: ratio,
                });
                if (error) throw error;
              } else {
                const args = {
                  p_store: store.id,
                  p_unit: unit.id,
                  p_name: name.trim(),
                  p_ratio: ratio,
                  p_sku: sku.trim(),
                  p_barcode: barcode.trim(),
                  p_cost: Number(cost),
                  p_selling: Number(selling),
                };
                const key = JSON.stringify(args);
                if (attempt.current?.key !== key)
                  attempt.current = { key, id: crypto.randomUUID() };
                const { data, error } = await db.rpc("create_bulk_product", {
                  ...args,
                  p_request: attempt.current.id,
                });
                if (error) throw error;
                id = data!;
              }
              const { data, error } = await db
                .from("v_product_catalog")
                .select("*")
                .eq("id", id!)
                .eq("store_id", store.id)
                .single();
              if (error) throw error;
              await cache.invalidateQueries({ queryKey: ["bulk-conversions"] });
              await cache.invalidateQueries({
                queryKey: ["operation-products"],
              });
              onPick(data as ProductStock);
              onClose();
            } catch (e) {
              setError(friendlyError((e as Error).message));
            } finally {
              lock.current = false;
              setBusy(false);
            }
          }}
        >
          <fieldset disabled={busy} className="space-y-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={existing}
                onChange={(e) => setExisting(e.target.checked)}
              />
              Use a product already in this location’s catalogue
            </label>
            <LocationProductPicker
              location={store.id}
              label="Existing individual item"
              itemType="Individual"
              value={unit}
              onChange={setUnit}
            />
            {existing ? (
              <LocationProductPicker
                location={store.id}
                label="Existing bulk product"
                value={pack}
                onChange={setPack}
              />
            ) : (
              <>
                <div>
                  <Label htmlFor="bulk-name">Bulk product name</Label>
                  <Input
                    id="bulk-name"
                    required
                    maxLength={300}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="bulk-sku">Bulk SKU</Label>
                    <Input
                      id="bulk-sku"
                      maxLength={128}
                      value={sku}
                      onChange={(e) => setSku(e.target.value)}
                      required={!barcode.trim()}
                    />
                  </div>
                  <div>
                    <Label htmlFor="bulk-barcode">Bulk barcode</Label>
                    <Input
                      id="bulk-barcode"
                      maxLength={128}
                      value={barcode}
                      onChange={(e) => setBarcode(e.target.value)}
                      required={!sku.trim()}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="bulk-cost">Cost per pack</Label>
                    <Input
                      id="bulk-cost"
                      type="number"
                      min="0"
                      step="0.01"
                      required
                      value={cost}
                      onChange={(e) => setCost(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="bulk-selling">Selling price per pack</Label>
                    <Input
                      id="bulk-selling"
                      type="number"
                      min="0"
                      step="0.01"
                      required
                      value={selling}
                      onChange={(e) => setSelling(e.target.value)}
                    />
                  </div>
                </div>
              </>
            )}
            <div>
              <Label htmlFor="bulk-ratio">Individual units per pack</Label>
              <Input
                id="bulk-ratio"
                type="number"
                min="1"
                max="100000"
                step="1"
                required
                value={ratio}
                onChange={(e) => setRatio(Number(e.target.value))}
              />
            </div>
            <p className="text-xs text-muted">
              Use the pack’s own SKU or barcode, distinct from the individual
              item. Expiry tracking follows the linked individual item.
            </p>
            <div className="flex gap-2">
              <Button type="button" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                loading={busy}
                disabled={
                  !online ||
                  !unit ||
                  (existing && (!pack || pack.id === unit.id))
                }
              >
                Save &amp; add bulk to receiving
              </Button>
            </div>
          </fieldset>
          {error && (
            <p role="alert" className="text-danger">
              {error}
            </p>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
