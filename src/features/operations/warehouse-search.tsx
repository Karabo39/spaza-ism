"use client";
import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
export function WarehouseSearch() {
  const router = useRouter(),
    path = usePathname(),
    params = useSearchParams();
  const [open, setOpen] = useState(!!params.get("q")),
    [value, setValue] = useState(params.get("q") ?? "");
  return (
    <div>
      <Button size="sm" onClick={() => setOpen(!open)}>
        <Search />
        Search Products
      </Button>
      {open && (
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const next = new URLSearchParams(params);
            next.delete("cursor");
            if (value.trim()) next.set("q", value.trim());
            else next.delete("q");
            router.replace(`${path}?${next}`);
          }}
        >
          <Input
            aria-label="Search warehouse products"
            placeholder="Name, SKU or barcode"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <Button size="sm" type="submit">
            Search
          </Button>
        </form>
      )}
    </div>
  );
}
