"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/format";
import type { ProductStock } from "@/lib/db/database.types";

export function ProductEditDialog({
  product,
  barcode = "",
}: {
  product: ProductStock & { undated_quantity?: number };
  barcode?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState({
    name: product.name,
    barcode,
    cost: String(product.cost_price),
    selling: String(product.selling_price),
    min: String(product.min_stock_level),
    reorder: String(product.reorder_level),
    unit: product.unit,
    track_expiry: product.track_expiry,
    is_active: product.is_active,
  });
  const [expiry, setExpiry] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const set = (k: keyof typeof form, v: string | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("save_product_details", {
      p_product: product.id,
      p_expiry: expiry || undefined,
      p_expected: product.undated_quantity ?? product.quantity,
      p_values: {
        name: form.name.trim(),
        ...(form.barcode.trim() || barcode
          ? { barcode: form.barcode.trim(), expected_barcode: barcode }
          : {}),
        cost_price: Number(form.cost) || 0,
        selling_price: Number(form.selling) || 0,
        min_stock_level: Number(form.min) || 0,
        reorder_level: Number(form.reorder) || 0,
        unit: form.unit.trim() || "each",
        track_expiry: form.track_expiry,
        is_active: form.is_active,
      },
    });
    setBusy(false);
    if (error) {
      toast.error(friendlyError(error.message));
      return;
    }
    toast.success("Product updated");
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Pencil className="size-4" /> Edit
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit product</DialogTitle>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <div>
              <Label htmlFor="e-name">Name</Label>
              <Input
                id="e-name"
                required
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="e-barcode">Barcode</Label>
              <Input
                id="e-barcode"
                value={form.barcode}
                maxLength={128}
                required={!!barcode}
                onChange={(e) => set("barcode", e.target.value)}
              />
              <p className="mt-1 text-xs text-muted">
                Changing this barcode replaces it for scanning. Other barcodes
                and stock history are kept.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="e-cost">Cost price</Label>
                <Input
                  id="e-cost"
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.cost}
                  onChange={(e) => set("cost", e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="e-sell">Selling price</Label>
                <Input
                  id="e-sell"
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.selling}
                  onChange={(e) => set("selling", e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="e-min">Min level</Label>
                <Input
                  id="e-min"
                  type="number"
                  step="0.001"
                  min="0"
                  value={form.min}
                  onChange={(e) => set("min", e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="e-re">Reorder</Label>
                <Input
                  id="e-re"
                  type="number"
                  step="0.001"
                  min="0"
                  value={form.reorder}
                  onChange={(e) => set("reorder", e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="e-unit">Unit</Label>
                <Input
                  id="e-unit"
                  value={form.unit}
                  onChange={(e) => set("unit", e.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3">
              <label className="flex items-center justify-between text-sm">
                <span>Track expiry (batches)</span>
                <input
                  type="checkbox"
                  checked={form.track_expiry}
                  onChange={(e) => set("track_expiry", e.target.checked)}
                />
              </label>
              {form.track_expiry &&
                (product.undated_quantity ?? product.quantity) > 0 && (
                  <div>
                    <Label htmlFor="e-expiry">Expiry for undated stock</Label>
                    <Input
                      id="e-expiry"
                      type="date"
                      required
                      value={expiry}
                      onChange={(e) => setExpiry(e.target.value)}
                    />
                    <p className="text-xs text-muted">
                      Applies to {product.undated_quantity ?? product.quantity}{" "}
                      undated units. Existing dated batches remain separate. Use
                      the batch section to split quantities.
                    </p>
                  </div>
                )}
              {form.track_expiry && product.quantity === 0 && (
                <p className="text-xs text-muted">
                  No stock yet. Enter the expiry when stock is received.
                </p>
              )}
              <label className="flex items-center justify-between text-sm">
                <span>Active (available for sale)</span>
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => set("is_active", e.target.checked)}
                />
              </label>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" loading={busy}>
                Save changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
