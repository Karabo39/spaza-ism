import Link from "next/link";
import { ArrowUpRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function MetricCard({
  label, value, sub, href, icon: Icon, tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  href?: string;
  icon: LucideIcon;
  tone?: "default" | "warning" | "danger" | "success" | "accent";
}) {
  const toneMap = {
    default: "text-muted",
    warning: "text-warning",
    danger: "text-danger",
    success: "text-success",
    accent: "text-accent",
  } as const;

  const body = (
    <div className="group relative rounded-lg border border-border bg-surface p-4 transition-colors hover:border-[#2a3a5c]">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted">{label}</p>
        <Icon className={cn("size-4", toneMap[tone])} />
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-muted">{sub}</p> : null}
      {href ? (
        <ArrowUpRight className="absolute bottom-3 right-3 size-4 text-muted opacity-0 transition-opacity group-hover:opacity-100" />
      ) : null}
    </div>
  );

  return href ? <Link href={href}>{body}</Link> : body;
}
