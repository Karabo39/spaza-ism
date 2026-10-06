"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
export function WarehouseSearch() {
  const router = useRouter(),
    path = usePathname(),
    params = useSearchParams();
  const [value, setValue] = useState(params.get("q") ?? "");
  useEffect(() => {
    const timer = setTimeout(() => {
      if (value.trim() === (params.get("q") ?? "")) return;
      const next = new URLSearchParams(params);
      next.delete("cursor");
      next.delete("page");
      if (value.trim()) next.set("q", value.trim());
      else next.delete("q");
      router.replace(`${path}?${next}`, { scroll: false });
    }, 250);
    return () => clearTimeout(timer);
  }, [value, params, path, router]);
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted" />
      <Input
        aria-label="Search warehouse products"
        placeholder="Search name, SKU or barcode…"
        className="pl-9"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
    </div>
  );
}
