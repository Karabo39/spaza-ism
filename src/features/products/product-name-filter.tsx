"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
export function ProductNameFilter({ store }: { store: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const [term, setTerm] = useState(params.get("name") ?? "");
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: ["product-names", store, term],
    enabled: open && term.trim().length > 0,
    queryFn: async () => {
      const { data, error } = await createClient()
        .from("products")
        .select("name")
        .eq("store_id", store)
        .ilike("name", `%${term}%`)
        .order("name")
        .limit(30);
      if (error) throw error;
      return [...new Set((data ?? []).map((p) => p.name))];
    },
  });
  function choose(name: string) {
    const next = new URLSearchParams(params);
    if (name) next.set("name", name);
    else next.delete("name");
    next.delete("page");
    router.push(`/products?${next}`);
    setTerm(name);
    setOpen(false);
  }
  return (
    <div className="relative max-w-sm">
      <label htmlFor="product-name-filter" className="text-sm">
        Filter by product name
      </label>
      <div className="mt-1 flex gap-2">
        <Input
          id="product-name-filter"
          value={term}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setTerm(e.target.value);
            setOpen(true);
          }}
          placeholder="Type a name to find matching products"
        />
        <Button variant="ghost" onClick={() => choose("")}>
          Clear
        </Button>
      </div>
      {open && term && (
        <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded border border-border bg-surface p-1 shadow-lg">
          {query.isLoading ? (
            <p role="status" className="p-3">
              Finding names...
            </p>
          ) : query.error ? (
            <p role="alert" className="p-3">
              Could not load names. Try again.
            </p>
          ) : query.data?.length ? (
            query.data.map((name) => (
              <button
                key={name}
                type="button"
                className="block min-h-11 w-full p-3 text-left text-sm hover:bg-surface-2"
                onClick={() => choose(name)}
              >
                {name}
              </button>
            ))
          ) : (
            <p className="p-3 text-sm">No matching names</p>
          )}
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Close
          </Button>
        </div>
      )}
    </div>
  );
}
