import Link from "next/link";
import type { Cursor } from "@/lib/data-pages";

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
  const url = (cursor?: Cursor) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params))
      if (value && key !== "cursor" && key !== "page") search.set(key, value);
    if (cursor) search.set("cursor", JSON.stringify(cursor));
    return `${basePath}?${search}`;
  };
  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between gap-4 border-t border-border px-4 py-3 text-sm"
    >
      <span className="text-muted">{count} records on this page</span>
      <div className="flex gap-4">
        {current && (
          <Link prefetch={false} href={url()}>
            First page
          </Link>
        )}
        {next && (
          <Link prefetch={false} href={url(next)} aria-label="Next page">
            Next page →
          </Link>
        )}
      </div>
    </nav>
  );
}
