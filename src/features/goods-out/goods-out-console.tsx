"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2, Plus, Minus, Banknote, HandCoins, UserPlus, PackageSearch, ShieldAlert } from "lucide-react";
import { ScanInput } from "@/features/scan/scan-input";
import { ProductSearchDialog } from "@/features/scan/product-search-dialog";
import { ProductRegisterDialog } from "@/features/products/product-register-dialog";
import { CustomerPicker } from "@/features/credit/customer-picker";
import { lookupByCode } from "@/features/scan/lookup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/misc";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store-context";
import { money, qty, friendlyError } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ProductStock, CreditCustomer } from "@/lib/db/database.types";

type Line = { productId: string; name: string; unit: string; quantity: number; unitPrice: number; stock: number };

export function GoodsOutConsole() {
  const router = useRouter();
  const { store, currency, can } = useStore();
  const [lines, setLines] = React.useState<Line[]>([]);
  const [saleType, setSaleType] = React.useState<"CASH" | "CREDIT">("CASH");
  const [customer, setCustomer] = React.useState<CreditCustomer | null>(null);
  const [override, setOverride] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [registerOpen, setRegisterOpen] = React.useState(false);
  const [unknownCode, setUnknownCode] = React.useState("");

  const total = React.useMemo(
    () => lines.reduce((sum, l) => sum + Math.round(l.quantity * l.unitPrice * 100) / 100, 0),
    [lines],
  );

  const projectedBalance = (customer?.balance ?? 0) + total;
  const wouldExceed = !!customer && customer.credit_limit > 0 && projectedBalance > customer.credit_limit;

  function addProduct(p: ProductStock) {
    setLines((prev) => {
      const existing = prev.find((l) => l.productId === p.id);
      if (existing) {
        return prev.map((l) => (l.productId === p.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...prev, { productId: p.id, name: p.name, unit: p.unit, quantity: 1, unitPrice: Number(p.selling_price), stock: Number(p.quantity) }];
    });
  }

  async function onScan(code: string) {
    setBusy(true);
    const hit = await lookupByCode(store.id, code);
    setBusy(false);
    if ("product" in hit) {
      if (hit.product.stock_status === "out") toast.warning(`${hit.product.name} is out of stock`);
      addProduct(hit.product);
    } else {
      setUnknownCode(code);
      toast.error(`No product for "${code}"`, {
        action: { label: "Register", onClick: () => setRegisterOpen(true) },
      });
    }
  }

  function setQty(id: string, q: number) {
    setLines((prev) => prev.map((l) => (l.productId === id ? { ...l, quantity: Math.max(0.001, q) } : l)));
  }
  function setPrice(id: string, p: number) {
    setLines((prev) => prev.map((l) => (l.productId === id ? { ...l, unitPrice: Math.max(0, p) } : l)));
  }
  function remove(id: string) {
    setLines((prev) => prev.filter((l) => l.productId !== id));
  }

  async function complete() {
    if (lines.length === 0) return;
    if (saleType === "CREDIT" && !customer) { toast.error("Select a customer for credit sale"); return; }
    if (saleType === "CREDIT" && wouldExceed && !override) {
      toast.error("Over credit limit — enable override (manager) to proceed");
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("complete_sale", {
      p_store: store.id,
      p_sale_type: saleType,
      p_customer: saleType === "CREDIT" ? customer!.customer_id : null,
      p_items: lines.map((l) => ({ product_id: l.productId, quantity: l.quantity, unit_price: l.unitPrice })),
      p_override: override,
    });
    setBusy(false);
    if (error || !data) { toast.error(friendlyError(error?.message)); return; }
    toast.success(
      saleType === "CASH" ? `Cash sale complete — ${money(total, currency)}` : `Credit sale to ${customer?.name} — ${money(total, currency)}`,
    );
    setLines([]); setCustomer(null); setOverride(false); setSaleType("CASH");
    router.refresh();
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        <ScanInput onScan={onScan} busy={busy} />
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted">{lines.length} item{lines.length === 1 ? "" : "s"} in cart</p>
          <Button variant="secondary" size="sm" onClick={() => setSearchOpen(true)}>
            <PackageSearch className="size-4" /> Add product
          </Button>
        </div>

        <div className="rounded-lg border border-border bg-surface">
          {lines.length === 0 ? (
            <EmptyState icon={PackageSearch} title="Scan to start a sale"
              description="Scan a barcode or use “Add product”. Items appear here." />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Product</TH>
                  <TH className="w-40 text-center">Qty</TH>
                  <TH className="w-32 text-right">Unit price</TH>
                  <TH className="w-28 text-right">Total</TH>
                  <TH className="w-10" />
                </TR>
              </THead>
              <TBody>
                {lines.map((l) => {
                  const over = l.quantity > l.stock;
                  return (
                    <TR key={l.productId}>
                      <TD>
                        <p className="font-medium">{l.name}</p>
                        <p className={cn("text-xs", over ? "text-danger" : "text-muted")}>
                          {over ? `Only ${qty(l.stock)} in stock` : `${qty(l.stock)} ${l.unit} available`}
                        </p>
                      </TD>
                      <TD>
                        <div className="flex items-center justify-center gap-1">
                          <Button variant="ghost" size="icon" className="size-7" onClick={() => setQty(l.productId, l.quantity - 1)}><Minus className="size-3.5" /></Button>
                          <Input value={l.quantity} onChange={(e) => setQty(l.productId, Number(e.target.value) || 0)}
                            type="number" step="0.001" min="0.001" className="h-8 w-16 text-center" />
                          <Button variant="ghost" size="icon" className="size-7" onClick={() => setQty(l.productId, l.quantity + 1)}><Plus className="size-3.5" /></Button>
                        </div>
                      </TD>
                      <TD className="text-right">
                        <Input value={l.unitPrice} onChange={(e) => setPrice(l.productId, Number(e.target.value) || 0)}
                          type="number" step="0.01" min="0" className="h-8 w-24 text-right ml-auto" />
                      </TD>
                      <TD className="text-right font-medium tabular-nums">{money(l.quantity * l.unitPrice, currency)}</TD>
                      <TD>
                        <Button variant="ghost" size="icon" className="size-7 text-muted hover:text-danger" onClick={() => remove(l.productId)}>
                          <Trash2 className="size-4" />
                        </Button>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </div>
      </div>

      {/* Checkout panel */}
      <div className="lg:sticky lg:top-20 h-fit space-y-4 rounded-lg border border-border bg-surface p-4">
        <div>
          <p className="mb-2 text-xs font-medium text-muted">Payment type</p>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setSaleType("CASH")}
              className={cn("flex items-center justify-center gap-2 rounded-md border py-2.5 text-sm font-medium transition-colors",
                saleType === "CASH" ? "border-accent/50 bg-accent/15 text-accent" : "border-border hover:bg-surface-2")}>
              <Banknote className="size-4" /> Cash
            </button>
            <button onClick={() => setSaleType("CREDIT")}
              className={cn("flex items-center justify-center gap-2 rounded-md border py-2.5 text-sm font-medium transition-colors",
                saleType === "CREDIT" ? "border-primary/50 bg-primary/15 text-primary-hover" : "border-border hover:bg-surface-2")}>
              <HandCoins className="size-4" /> Credit
            </button>
          </div>
        </div>

        {saleType === "CREDIT" ? (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted">Customer</p>
            {customer ? (
              <div className="rounded-md border border-border bg-surface-2 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">{customer.name}</p>
                  <button className="text-xs text-accent hover:underline" onClick={() => setPickerOpen(true)}>Change</button>
                </div>
                <div className="mt-1 flex justify-between text-xs text-muted">
                  <span>Balance {money(customer.balance, currency)}</span>
                  <span>Limit {customer.credit_limit > 0 ? money(customer.credit_limit, currency) : "—"}</span>
                </div>
              </div>
            ) : (
              <Button variant="secondary" className="w-full" onClick={() => setPickerOpen(true)}>
                <UserPlus className="size-4" /> Select customer
              </Button>
            )}

            {wouldExceed ? (
              <div className="rounded-md border border-danger/40 bg-danger/10 p-3 text-xs">
                <p className="flex items-center gap-1.5 font-medium text-danger"><ShieldAlert className="size-4" /> Over credit limit</p>
                <p className="mt-1 text-muted-foreground">New balance would be {money(projectedBalance, currency)}.</p>
                {can("manager") ? (
                  <label className="mt-2 flex items-center gap-2 text-foreground">
                    <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
                    Authorize override
                  </label>
                ) : (
                  <p className="mt-2 text-danger">A manager must authorize this sale.</p>
                )}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="border-t border-border pt-3">
          <div className="flex items-end justify-between">
            <span className="text-sm text-muted">Total</span>
            <span className="text-2xl font-semibold tabular-nums">{money(total, currency)}</span>
          </div>
        </div>

        <Button className="w-full" size="lg" loading={busy} disabled={lines.length === 0}
          variant={saleType === "CREDIT" ? "primary" : "primary"} onClick={complete}>
          {saleType === "CASH" ? "Complete cash sale" : "Complete credit sale"}
        </Button>
      </div>

      <ProductSearchDialog open={searchOpen} onOpenChange={setSearchOpen} onPick={addProduct} />
      <CustomerPicker open={pickerOpen} onOpenChange={setPickerOpen} onSelect={(c) => { setCustomer(c); setOverride(false); }} />
      <ProductRegisterDialog open={registerOpen} onOpenChange={setRegisterOpen} initialBarcode={unknownCode}
        onCreated={(p) => addProduct(p)} />
    </div>
  );
}
