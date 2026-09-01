"use client";
import * as React from "react";
import { toast } from "sonner";
import { Tag, PackageSearch } from "lucide-react";
import { ScanInput } from "@/features/scan/scan-input";
import { ProductSearchDialog } from "@/features/scan/product-search-dialog";
import { ProductRegisterDialog } from "@/features/products/product-register-dialog";
import { StockStatusBadge } from "@/features/stock/status-badge";
import { Button } from "@/components/ui/button";
import { lookupByCode } from "@/features/scan/lookup";
import { useStore } from "@/lib/store-context";
import { money, qty } from "@/lib/format";
import type { ProductStock } from "@/lib/db/database.types";

export function CheckPriceConsole() {
  const { store, currency, can } = useStore();
  const [current, setCurrent] = React.useState<ProductStock | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [registerOpen, setRegisterOpen] = React.useState(false);
  const [unknown, setUnknown] = React.useState("");
  const showMargin = can("manager");

  async function onScan(code: string) {
    setBusy(true);
    const hit = await lookupByCode(store.id, code);
    setBusy(false);
    if ("product" in hit) setCurrent(hit.product);
    else {
      setUnknown(code);
      setCurrent(null);
      toast.error(`No product for "${code}"`, { action: { label: "Register", onClick: () => setRegisterOpen(true) } });
    }
  }

  const margin = current ? Number(current.selling_price) - Number(current.cost_price) : 0;
  const marginPct = current && Number(current.selling_price) > 0 ? (margin / Number(current.selling_price)) * 100 : 0;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <ScanInput onScan={onScan} busy={busy} placeholder="Scan or type to check price & stock" />
      <div className="flex justify-end">
        <Button variant="secondary" size="sm" onClick={() => setSearchOpen(true)}>
          <PackageSearch className="size-4" /> Find product
        </Button>
      </div>

      {current ? (
        <div className="rounded-lg border border-border bg-surface p-6">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-xl font-semibold">{current.name}</h2>
              <p className="text-sm text-muted">{current.category_name ?? "Uncategorised"}{current.supplier_name ? ` · ${current.supplier_name}` : ""}</p>
            </div>
            <StockStatusBadge status={current.stock_status} />
          </div>

          <div className="mt-6 grid grid-cols-2 gap-4">
            <div className="rounded-md border border-border bg-surface-2 p-4">
              <p className="text-xs text-muted">Selling price</p>
              <p className="mt-1 text-3xl font-semibold tabular-nums text-primary-hover">{money(current.selling_price, currency)}</p>
            </div>
            <div className="rounded-md border border-border bg-surface-2 p-4">
              <p className="text-xs text-muted">In stock</p>
              <p className="mt-1 text-3xl font-semibold tabular-nums">{qty(current.quantity)}<span className="ml-1 text-base text-muted">{current.unit}</span></p>
            </div>
          </div>

          {showMargin ? (
            <div className="mt-4 grid grid-cols-3 gap-4 border-t border-border pt-4 text-sm">
              <div><p className="text-xs text-muted">Cost</p><p className="tabular-nums">{money(current.cost_price, currency)}</p></div>
              <div><p className="text-xs text-muted">Margin</p><p className="tabular-nums">{money(margin, currency)}</p></div>
              <div><p className="text-xs text-muted">Margin %</p><p className="tabular-nums">{marginPct.toFixed(1)}%</p></div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-surface/50 py-16 text-center">
          <Tag className="size-8 text-muted" />
          <p className="text-sm text-muted">Scan a product to see its price and stock instantly.</p>
        </div>
      )}

      <ProductSearchDialog open={searchOpen} onOpenChange={setSearchOpen} onPick={setCurrent} />
      <ProductRegisterDialog open={registerOpen} onOpenChange={setRegisterOpen} initialBarcode={unknown} onCreated={setCurrent} />
    </div>
  );
}
