"use client";
import * as React from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store-context";
import { friendlyError } from "@/lib/format";
import type { ProductStock } from "@/lib/db/database.types";

export function ProductRegisterDialog({
  open, onOpenChange, initialBarcode = "", initialName = "", onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialBarcode?: string;
  initialName?: string;
  onCreated?: (product: ProductStock) => void;
}) {
  const { store } = useStore();
  const [name, setName] = React.useState(initialName);
  const [barcode, setBarcode] = React.useState(initialBarcode);
  const [selling, setSelling] = React.useState("");
  const [cost, setCost] = React.useState("");
  const [minLevel, setMinLevel] = React.useState("");
  const [reorder, setReorder] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setName(initialName);
      setBarcode(initialBarcode);
      setSelling(""); setCost(""); setMinLevel(""); setReorder("");
    }
  }, [open, initialBarcode, initialName]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const supabase = createClient();
    const { data: id, error } = await supabase.rpc("create_product", {
      p_store: store.id,
      p_name: name.trim(),
      p_barcode: barcode.trim() || undefined,
      p_cost: Number(cost) || 0,
      p_selling: Number(selling) || 0,
      p_min: Number(minLevel) || 0,
      p_reorder: Number(reorder) || 0,
    });
    if (error || !id) {
      setLoading(false);
      toast.error(friendlyError(error?.message));
      return;
    }
    const { data: product } = await supabase.from("v_product_stock").select("*").eq("id", id as string).maybeSingle();
    setLoading(false);
    toast.success(`${name} added to catalog`);
    onOpenChange(false);
    if (product) onCreated?.(product as ProductStock);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Register new product</DialogTitle>
          <DialogDescription>This barcode isn&apos;t in your catalog yet. Add it to continue.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="p-name">Product name</Label>
            <Input id="p-name" required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Coca-Cola 500ml" />
          </div>
          <div>
            <Label htmlFor="p-barcode">Barcode</Label>
            <Input id="p-barcode" value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="Scan or type" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="p-cost">Cost price</Label>
              <Input id="p-cost" type="number" step="0.01" min="0" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <Label htmlFor="p-sell">Selling price</Label>
              <Input id="p-sell" type="number" step="0.01" min="0" value={selling} onChange={(e) => setSelling(e.target.value)} placeholder="0.00" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="p-min">Min stock level</Label>
              <Input id="p-min" type="number" step="0.001" min="0" value={minLevel} onChange={(e) => setMinLevel(e.target.value)} placeholder="0" />
            </div>
            <div>
              <Label htmlFor="p-reorder">Reorder level</Label>
              <Input id="p-reorder" type="number" step="0.001" min="0" value={reorder} onChange={(e) => setReorder(e.target.value)} placeholder="0" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={loading}>Add product</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
