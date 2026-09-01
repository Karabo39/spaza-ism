import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** Server-friendly pagination: builds hrefs from current search params. */
export function Pagination({
  page, pageSize, total, params, basePath,
}: {
  page: number;
  pageSize: number;
  total: number;
  params: Record<string, string | undefined>;
  basePath: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
    sp.set("page", String(p));
    return `${basePath}?${sp.toString()}`;
  };

  return (
    <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm text-muted">
      <span>{from}–{to} of {total}</span>
      <div className="flex items-center gap-1">
        <Link aria-disabled={page <= 1} href={page <= 1 ? "#" : href(page - 1)}
          className={`flex size-8 items-center justify-center rounded-md border border-border ${page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-surface-2"}`}>
          <ChevronLeft className="size-4" />
        </Link>
        <span className="px-2 tabular-nums">{page} / {pages}</span>
        <Link aria-disabled={page >= pages} href={page >= pages ? "#" : href(page + 1)}
          className={`flex size-8 items-center justify-center rounded-md border border-border ${page >= pages ? "pointer-events-none opacity-40" : "hover:bg-surface-2"}`}>
          <ChevronRight className="size-4" />
        </Link>
      </div>
    </div>
  );
}
