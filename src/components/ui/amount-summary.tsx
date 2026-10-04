import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Read-only totals styled like the Received status; deliberately not a button. */
export function AmountSummary({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex min-h-10 items-center rounded-md border border-emerald-400 bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950",
        className,
      )}
    >
      <span>{children}</span>
    </div>
  );
}
