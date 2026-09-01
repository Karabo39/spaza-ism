"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Search, Boxes, User } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store-context";
import { money } from "@/lib/format";

type Result =
  | { kind: "product"; id: string; name: string; extra: string }
  | { kind: "customer"; id: string; name: string; extra: string };

export function GlobalSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter();
  const { store } = useStore();
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState<Result[]>([]);
  const [loading, setLoading] = React.useState(false);

  // "/" opens search from anywhere (unless typing in a field).
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement;
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable;
      if (e.key === "/" && !typing) {
        e.preventDefault();
        onOpenChange(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpenChange]);

  React.useEffect(() => {
    if (!open) { setQ(""); setResults([]); }
  }, [open]);

  React.useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults([]); return; }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      const supabase = createClient();
      const [prod, cust, byBarcode] = await Promise.all([
        supabase.from("products").select("id, name, selling_price")
          .eq("store_id", store.id).ilike("name", `%${term}%`).limit(6),
        supabase.from("customers").select("id, name, phone")
          .eq("store_id", store.id).ilike("name", `%${term}%`).limit(4),
        supabase.from("product_barcodes").select("product_id, barcode, products(name, selling_price)")
          .eq("store_id", store.id).eq("barcode", term).limit(3),
      ]);
      if (cancelled) return;
      const out: Result[] = [];
      for (const p of prod.data ?? []) out.push({ kind: "product", id: p.id, name: p.name, extra: money(p.selling_price) });
      for (const b of byBarcode.data ?? []) {
        const prod = b.products as unknown as { name: string; selling_price: number } | null;
        if (prod && !out.some((r) => r.kind === "product" && r.id === b.product_id))
          out.push({ kind: "product", id: b.product_id, name: prod.name, extra: `Barcode ${b.barcode}` });
      }
      for (const c of cust.data ?? []) out.push({ kind: "customer", id: c.id, name: c.name, extra: c.phone ?? "" });
      setResults(out);
      setLoading(false);
    }, 220);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, store.id]);

  function go(r: Result) {
    onOpenChange(false);
    if (r.kind === "product") router.push(`/products/${r.id}`);
    else router.push(`/credit/${r.id}`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[15%] translate-y-0 p-0 sm:max-w-xl">
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Search className="size-4 text-muted" />
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search products by name or barcode, or customers…"
            className="h-12 border-0 bg-transparent focus-ring:shadow-none px-0 focus-visible:ring-0"
          />
        </div>
        <div className="max-h-80 overflow-y-auto p-2">
          {loading && results.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted">Searching…</p>
          ) : results.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted">
              {q.trim().length < 2 ? "Type at least 2 characters." : "No matches."}
            </p>
          ) : (
            results.map((r) => (
              <button
                key={`${r.kind}-${r.id}`}
                onClick={() => go(r)}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm hover:bg-surface-2"
              >
                {r.kind === "product" ? <Boxes className="size-4 text-accent" /> : <User className="size-4 text-primary-hover" />}
                <span className="flex-1 truncate">{r.name}</span>
                <span className="text-xs text-muted">{r.extra}</span>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
