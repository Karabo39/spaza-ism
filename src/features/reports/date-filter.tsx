"use client";
import * as React from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

/** From/to date inputs that sync to `from`/`to` URL params (server reads them). */
export function DateFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function update(key: "from" | "to", value: string) {
    const next = new URLSearchParams(Array.from(params.entries()));
    if (value) next.set(key, value); else next.delete(key);
    router.replace(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <label className="flex items-center gap-1.5 text-muted">
        From
        <input type="date" defaultValue={params.get("from") ?? ""} onChange={(e) => update("from", e.target.value)}
          className="rounded-md border border-border bg-input px-2 py-1.5 text-foreground" />
      </label>
      <label className="flex items-center gap-1.5 text-muted">
        To
        <input type="date" defaultValue={params.get("to") ?? ""} onChange={(e) => update("to", e.target.value)}
          className="rounded-md border border-border bg-input px-2 py-1.5 text-foreground" />
      </label>
    </div>
  );
}
