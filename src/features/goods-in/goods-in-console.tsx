"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2, PackageSearch, PackagePlus } from "lucide-react";
import { ScanInput } from "@/features/scan/scan-input";
import { ProductSearchDialog } from "@/features/scan/product-search-dialog";
import { ProductRegisterDialog } from "@/features/products/product-register-dialog";
import { lookupByCode } from "@/features/scan/lookup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/misc";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store-context";
import { money, friendlyError } from "@/lib/format";
import type { ProductStock } from "@/lib/db/database.types";

type Line = { productId: string; name: string; unit: string; quantity: number; unitCost: number; trackExpiry: boolean; expiry: string };

export function GoodsInConsole() {
  const router = useRouter();
  const { store, currency } = useStore();
  const [lines, setLines] = React.useState<Line[]>([]);
  const [suppliers, setSuppliers] = React.useState<{ id: string; name: string }[]>([]);
  const [supplierId, setSupplierId] = React.useState<string>("none");
  const [reference, setReference] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [registerOpen, setRegisterOpen] = React.useState(false);
  const [unknownCode, setUnknownCode] = React.useState("");

  React.useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.from("suppliers").select("id, name").eq("business_id", store.businessId).eq("is_active", true).order("name");
      setSuppliers(data ?? []);
    })();
  }, [store.businessId]);

  const total = React.useMemo(
    () => lines.reduce((s, l) => s + Math.round(l.quantity * l.unitCost * 100) / 100, 0),
    [lines],
  );

  function addProduct(p: ProductStock) {
    setLines((prev) => {
      const ex = prev.find((l) => l.productId === p.id);
      if (ex) return prev.map((l) => (l.productId === p.id ? { ...l, quantity: l.quantity + 1 } : l));
      return [...prev, { productId: p.id, name: p.name, unit: p.unit, quantity: 1, unitCost: Number(p.cost_price), trackExpiry: p.track_expiry, expiry: "" }];
    });
  }

  async function onScan(code: string) {
    setBusy(true);
    const hit = await lookupByCode(store.id, code);
    setBusy(false);
    if ("product" in hit) addProduct(hit.product);
    else {
      setUnknownCode(code);
      toast.error(`No product for "${code}"`, { action: { label: "Register", onClick: () => setRegisterOpen(true) } });
    }
  }

  const patch = (id: string, p: Partial<Line>) => setLines((prev) => prev.map((l) => (l.productId === id ? { ...l, ...p } : l)));
  const remove = (id: string) => setLines((prev) => prev.filter((l) => l.productId !== id));

  async function complete() {
    if (lines.length === 0) return;
    for (const l of lines) if (l.quantity <= 0) { toast.error(`Enter a quantity for ${l.name}`); return; }
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("receive_stock", {
      p_store: store.id,
      p_supplier: supplierId === "none" ? null : supplierId,
      p_reference: reference.trim() || null,
      p_note: null,
      p_items: lines.map((l) => ({
        product_id: l.productId, quantity: l.quantity, unit_cost: l.unitCost,
        expiry_date: l.trackExpiry && l.expiry ? l.expiry : null,
      })),
    });
    setBusy(false);
    if (error || !data) { toast.error(friendlyError(error?.message)); return; }
    toast.success(`Received ${lines.length} item${lines.length === 1 ? "" : "s"} — ${money(total, currency)}`);
    setLines([]); setReference(""); setSupplierId("none");
    router.refresh();
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        <ScanInput onScan={onScan} busy={busy} placeholder="Scan received products, then Enter" />
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted">{lines.length} line{lines.length === 1 ? "" : "s"}</p>
          <Button variant="secondary" size="sm" onClick={() => setSearchOpen(true)}>
            <PackageSearch className="size-4" /> Add product
          </Button>
        </div>
        <div className="rounded-lg border border-border bg-surface">
          {lines.length === 0 ? (
            <EmptyState icon={PackagePlus} title="Scan received goods"
              description="Scan barcodes to build the receiving list. Stock updates on confirmation." />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Product</TH>
                  <TH className="w-28 text-center">Qty</TH>
                  <TH className="w-28 text-right">Unit cost</TH>
                  <TH className="w-28 text-right">Total</TH>
                  <TH className="w-10" />
                </TR>
              </THead>
              <TBody>
                {lines.map((l) => (
                  <TR key={l.productId}>
                    <TD>
                      <p className="font-medium">{l.name}</p>
                      {l.trackExpiry ? (
                        <div className="mt-1 flex items-center gap-1.5">
                          <span className="text-xs text-muted">Expiry:</span>
                          <input type="date" value={l.expiry} onChange={(e) => patch(l.productId, { expiry: e.target.value })}
                            className="rounded border border-border bg-input px-1.5 py-0.5 text-xs" />
                        </div>
                      ) : null}
                    </TD>
                    <TD>
                      <Input value={l.quantity} onChange={(e) => patch(l.productId, { quantity: Number(e.target.value) || 0 })}
                        type="number" step="0.001" min="0" className="h-8 w-20 text-center mx-auto" />
                    </TD>
                    <TD className="text-right">
                      <Input value={l.unitCost} onChange={(e) => patch(l.productId, { unitCost: Number(e.target.value) || 0 })}
                        type="number" step="0.01" min="0" className="h-8 w-24 text-right ml-auto" />
                    </TD>
                    <TD className="text-right font-medium tabular-nums">{money(l.quantity * l.unitCost, currency)}</TD>
                    <TD>
                      <Button variant="ghost" size="icon" className="size-7 text-muted hover:text-danger" onClick={() => remove(l.productId)}>
                        <Trash2 className="size-4" />
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </div>
      </div>

      <div className="lg:sticky lg:top-20 h-fit space-y-4 rounded-lg border border-border bg-surface p-4">
        <div>
          <Label htmlFor="supplier">Supplier (optional)</Label>
          <Select value={supplierId} onValueChange={setSupplierId}>
            <SelectTrigger id="supplier"><SelectValue placeholder="Select supplier" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No supplier</SelectItem>
              {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="ref">Invoice / reference (optional)</Label>
          <Input id="ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="INV-00123" />
        </div>
        <div className="border-t border-border pt-3">
          <div className="flex items-end justify-between">
            <span className="text-sm text-muted">Total cost</span>
            <span className="text-2xl font-semibold tabular-nums">{money(total, currency)}</span>
          </div>
        </div>
        <Button className="w-full" size="lg" loading={busy} disabled={lines.length === 0} onClick={complete}>
          Confirm &amp; add to stock
        </Button>
      </div>

      <ProductSearchDialog open={searchOpen} onOpenChange={setSearchOpen} onPick={addProduct} showPrice={false} />
      <ProductRegisterDialog open={registerOpen} onOpenChange={setRegisterOpen} initialBarcode={unknownCode} onCreated={addProduct} />
    </div>
  );
}
