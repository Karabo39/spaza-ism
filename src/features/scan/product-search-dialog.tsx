"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useStore } from "@/lib/store-context";
import { searchProducts } from "./lookup";
import { money, qty } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import type { ProductStock } from "@/lib/db/database.types";

function ProductSearchDialogContent({
  open,
  onOpenChange,
  onPick,
  showPrice = true,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPick: (p: ProductStock) => void;
  showPrice?: boolean;
}) {
  const { store, currency } = useStore();
  const [q, setQ] = React.useState("");
  const term = useDebouncedValue(q.trim(), 180);
  const search = useQuery({
    queryKey: ["product-picker", store.id, term],
    queryFn: () => searchProducts(store.id, term),
    networkMode: "always",
    staleTime: 0,
  });
  const waiting = q.trim() !== term || search.isLoading;
  const rows = waiting ? [] : (search.data ?? []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add product</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-md border border-border bg-input px-3">
          <Search className="size-4 text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
            placeholder="Search by name…"
            className="h-11 min-w-0 flex-1 bg-transparent text-sm focus:outline-none"
          />
        </div>
        <div className="max-h-80 space-y-1 overflow-y-auto">
          {search.isError ? (
            <p role="alert" className="p-4 text-sm text-danger">
              Couldn&apos;t load products.{" "}
              <Button variant="ghost" onClick={() => search.refetch()}>
                Retry
              </Button>
            </p>
          ) : waiting ? (
            <p role="status" className="p-4 text-sm text-muted">
              Searching...
            </p>
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">
              No products found.
            </p>
          ) : (
            rows.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  onPick(p);
                  onOpenChange(false);
                }}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left hover:bg-surface-2"
              >
                <div className="min-w-0 flex-1 break-words">
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="text-xs text-muted">
                    In stock: {qty(p.quantity)} {p.unit}
                  </p>
                </div>
                {p.stock_status === "out" ? (
                  <Badge variant="danger">Out</Badge>
                ) : p.stock_status === "low" ? (
                  <Badge variant="warning">Low</Badge>
                ) : null}
                {showPrice ? (
                  <span className="text-sm tabular-nums text-muted-foreground">
                    {money(p.selling_price, currency)}
                  </span>
                ) : null}
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ProductSearchDialog(
  props: React.ComponentProps<typeof ProductSearchDialogContent>,
) {
  const { store } = useStore();
  return props.open ? (
    <ProductSearchDialogContent key={store.id} {...props} />
  ) : null;
}
