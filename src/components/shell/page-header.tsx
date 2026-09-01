import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

export type Crumb = { label: string; href?: string };

export function PageHeader({
  title,
  crumbs,
  description,
  actions,
}: {
  title: string;
  crumbs?: Crumb[];
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {crumbs && crumbs.length > 0 ? (
          <nav className="mb-1 flex items-center gap-1 text-xs text-muted">
            {crumbs.map((c, i) => (
              <React.Fragment key={i}>
                {c.href ? (
                  <Link href={c.href} className="hover:text-foreground">{c.label}</Link>
                ) : (
                  <span>{c.label}</span>
                )}
                {i < crumbs.length - 1 ? <ChevronRight className="size-3" /> : null}
              </React.Fragment>
            ))}
          </nav>
        ) : null}
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
