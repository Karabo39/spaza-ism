"use client";
import * as React from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";

/** Debounced search box that syncs to the `q` URL param (server components read it). */
export function ToolbarSearch({ placeholder = "Search…", paramName = "q" }: { placeholder?: string; paramName?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = React.useState(params.get(paramName) ?? "");

  React.useEffect(() => {
    const t = setTimeout(() => {
      const next = new URLSearchParams(Array.from(params.entries()));
      if (value.trim()) next.set(paramName, value.trim());
      else next.delete(paramName);
      next.delete("page");
      router.replace(`${pathname}?${next.toString()}`);
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="flex h-10 w-full items-center gap-2 rounded-md border border-border bg-input px-3 sm:w-72">
      <Search className="size-4 text-muted" />
      <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder}
        className="flex-1 bg-transparent text-sm focus:outline-none" />
    </div>
  );
}
