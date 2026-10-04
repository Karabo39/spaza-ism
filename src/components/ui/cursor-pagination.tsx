"use client";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { useStore } from "@/lib/store-context";
import type { Cursor } from "@/lib/data-pages";

const previousPages = new Map<string, string>();
const subscribe = (notify: () => void) => {
  window.addEventListener("cursor-history", notify);
  return () => window.removeEventListener("cursor-history", notify);
};
function readPrevious(key: string) {
  try {
    return previousPages.get(key) ?? sessionStorage.getItem(key);
  } catch {
    return previousPages.get(key) ?? null;
  }
}

export function CursorPagination({
  next,
  current,
  count,
  basePath,
  params,
}: {
  next: Cursor | null;
  current?: string;
  count: number;
  basePath: string;
  params: Record<string, string | undefined>;
}) {
  const { store } = useStore();
  const scope = JSON.stringify([
    store.id,
    basePath,
    Object.entries(params)
      .filter(([k]) => k !== "cursor" && k !== "page")
      .sort(),
  ]);
  const key = `cursor:${scope}:${current ?? ""}`;
  const previous = useSyncExternalStore(
    subscribe,
    () => readPrevious(key),
    () => null,
  );
  const url = (cursor?: string) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params))
      if (value && key !== "cursor" && key !== "page") search.set(key, value);
    if (cursor) search.set("cursor", cursor);
    return `${basePath}?${search}`;
  };
  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between gap-4 border-t border-border px-4 py-3 text-sm"
    >
      <span className="text-muted">{count} records on this page</span>
      <div className="flex gap-4">
        {current && previous !== null && (
          <Link prefetch={false} href={url(previous)}>
            Previous Page
          </Link>
        )}
        {next && (
          <Link
            prefetch={false}
            href={url(JSON.stringify(next))}
            aria-label="Next page"
            onClick={() => {
              const nextKey = `cursor:${scope}:${JSON.stringify(next)}`;
              previousPages.set(nextKey, current ?? "");
              try {
                sessionStorage.setItem(nextKey, current ?? "");
              } catch {
                /* Navigation still works with in-memory history. */
              }
              window.dispatchEvent(new Event("cursor-history"));
            }}
          >
            Next page →
          </Link>
        )}
      </div>
    </nav>
  );
}
