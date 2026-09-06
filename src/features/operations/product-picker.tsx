"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { qty } from "@/lib/format";
import type { ProductStock } from "@/lib/db/database.types";

export function LocationProductPicker({ location, label, value, onChange }: {
  location: string; label: string; value: ProductStock | null; onChange: (product: ProductStock | null) => void;
}) {
  const [search, setSearch] = React.useState("");
  const id = React.useId();
  const { data, error, isLoading } = useQuery({
    queryKey: ["operation-products", location, search], enabled: !!location,
    queryFn: async () => {
      const { data, error } = await createClient().from("v_product_stock").select("*").eq("store_id", location)
        .eq("is_active", true).ilike("name", `%${search}%`).order("name").limit(100);
      if (error) throw error;
      return data as ProductStock[];
    },
  });
  const rows = value && !(data ?? []).some((p) => p.id === value.id) ? [value, ...(data ?? [])] : data ?? [];
  return <div className="space-y-1.5">
    <Label htmlFor={id}>{label}</Label>
    <Input aria-label={`Search ${label.toLowerCase()}`} placeholder="Search product name" value={search} onChange={(e) => setSearch(e.target.value)} disabled={!location} />
    <select id={id} className="h-10 w-full rounded-md border border-border bg-input px-2 text-sm" disabled={!location || isLoading} value={value?.id ?? ""} onChange={(e) => onChange(rows.find((p) => p.id === e.target.value) ?? null)}>
      <option value="">{isLoading ? "Loading…" : "Select product"}</option>
      {rows.map((p) => <option key={p.id} value={p.id}>{p.name} · {qty(p.quantity)} {p.unit}</option>)}
    </select>
    {error ? <p role="alert" className="text-xs text-danger">Could not load products. Reconnect and try again.</p> : null}
  </div>;
}
