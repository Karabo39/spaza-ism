"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { qty } from "@/lib/format";
import { money } from "@/lib/format";
import { ChevronDown } from "lucide-react";
import { useStore } from "@/lib/store-context";
import type { ProductStock } from "@/lib/db/database.types";

type PickerProps = {
  location: string;
  label: string;
  value: ProductStock | null;
  onChange: (product: ProductStock | null) => void;
};
export function LocationProductPicker(
  props: PickerProps & { searchable?: boolean },
) {
  return props.searchable ? (
    <SearchProductPicker key={props.location} {...props} />
  ) : (
    <LegacyProductPicker {...props} />
  );
}
function LegacyProductPicker({
  location,
  label,
  value,
  onChange,
}: PickerProps) {
  const [search, setSearch] = React.useState("");
  const id = React.useId();
  const { data, error, isLoading } = useQuery({
    queryKey: ["operation-products", location, search],
    enabled: !!location,
    queryFn: async () => {
      const { data, error } = await createClient()
        .from("v_product_stock")
        .select("*")
        .eq("store_id", location)
        .eq("is_active", true)
        .ilike("name", `%${search}%`)
        .order("name")
        .limit(100);
      if (error) throw error;
      return data as ProductStock[];
    },
  });
  const rows =
    value && !(data ?? []).some((p) => p.id === value.id)
      ? [value, ...(data ?? [])]
      : (data ?? []);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        aria-label={`Search ${label.toLowerCase()}`}
        placeholder="Search product name"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        disabled={!location}
      />
      <select
        id={id}
        className="h-10 w-full rounded-md border border-border bg-input px-2 text-sm"
        disabled={!location || isLoading}
        value={value?.id ?? ""}
        onChange={(e) =>
          onChange(rows.find((p) => p.id === e.target.value) ?? null)
        }
      >
        <option value="">{isLoading ? "Loading…" : "Select product"}</option>
        {rows.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} · {qty(p.quantity)} {p.unit}
          </option>
        ))}
      </select>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          Could not load products. Reconnect and try again.
        </p>
      ) : null}
    </div>
  );
}

function SearchProductPicker({
  location,
  label,
  value,
  onChange,
}: PickerProps) {
  const { currency } = useStore();
  const [search, setSearch] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const input = React.useRef<HTMLInputElement>(null);
  const id = React.useId();
  const {
    data = [],
    error,
    isFetching,
  } = useQuery({
    queryKey: ["order-product-search", location, search],
    enabled: !!location && open,
    queryFn: async () => {
      const { data, error } = await createClient()
        .from("v_product_stock")
        .select("*")
        .eq("store_id", location)
        .eq("is_active", true)
        .ilike("name", `%${search.replace(/[\\%_]/g, "\\$&")}%`)
        .order("name")
        .limit(100);
      if (error) throw error;
      return data as ProductStock[];
    },
  });
  const index = Math.min(active, Math.max(data.length - 1, 0));
  function choose(product: ProductStock) {
    onChange(product);
    setSearch("");
    setOpen(false);
    input.current?.focus();
  }
  return (
    <div
      className="relative min-w-0 space-y-1.5"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          ref={input}
          id={id}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-activedescendant={
            open && data.length && !isFetching ? `${id}-${index}` : undefined
          }
          className="pr-12"
          placeholder="Search product name"
          disabled={!location}
          value={value?.name ?? search}
          onChange={(e) => {
            setSearch(e.target.value);
            onChange(null);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              return;
            }
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setOpen(true);
              setActive(
                open
                  ? Math.max(
                      0,
                      Math.min(
                        data.length - 1,
                        index + (e.key === "ArrowDown" ? 1 : -1),
                      ),
                    )
                  : 0,
              );
            }
            if (e.key === "Enter" && open) {
              e.preventDefault();
              if (data[index] && !isFetching && !error) choose(data[index]);
            }
          }}
        />
        <button
          type="button"
          aria-label="Show products"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          disabled={!location}
          className="absolute right-0 top-0 flex h-10 w-11 items-center justify-center rounded-r-md focus-visible:outline-2 focus-visible:outline-accent"
          onClick={() => {
            setOpen(!open);
            setActive(0);
            input.current?.focus();
          }}
        >
          <ChevronDown className="size-4" />
        </button>
      </div>
      {open && (
        <div className="absolute left-0 right-0 z-30 max-h-72 overflow-y-auto rounded-md border border-border bg-surface shadow-lg">
          {isFetching ? (
            <p role="status" className="p-3 text-sm">
              Loading products…
            </p>
          ) : error ? (
            <p role="alert" className="p-3 text-sm text-danger">
              Could not load products. Close and reopen to retry.
            </p>
          ) : data.length === 0 ? (
            <p role="status" className="p-3 text-sm">
              No matching products.
            </p>
          ) : null}
          <ul id={`${id}-list`} role="listbox" aria-label="Products">
            {!isFetching &&
              !error &&
              data.map((p, n) => (
                <li
                  key={p.id}
                  id={`${id}-${n}`}
                  role="option"
                  aria-selected={n === index}
                  className={`cursor-pointer px-3 py-2 text-sm ${n === index ? "bg-accent/10" : ""}`}
                  onMouseEnter={() => setActive(n)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(p)}
                >
                  <span className="block break-words font-medium">
                    {p.name}
                  </span>
                  <span className="block text-xs text-muted">
                    {money(Number(p.selling_price), currency)} ·{" "}
                    {qty(p.quantity)} {p.unit} available
                  </span>
                </li>
              ))}
          </ul>
          {data.length === 100 && (
            <p className="p-2 text-xs text-muted">
              First 100 matches. Type more to narrow the search.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
