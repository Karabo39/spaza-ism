import Link from "next/link";
import { PackagePlus, PackageMinus, Search, Tag, SlidersHorizontal, Users, type LucideIcon } from "lucide-react";

const ACTIONS: { href: string; label: string; icon: LucideIcon; primary?: boolean }[] = [
  { href: "/goods-out", label: "Goods Out", icon: PackageMinus, primary: true },
  { href: "/goods-in", label: "Goods In", icon: PackagePlus },
  { href: "/check-stock", label: "Check Stock", icon: Search },
  { href: "/check-price", label: "Check Price", icon: Tag },
  { href: "/adjust", label: "Adjust Stock", icon: SlidersHorizontal },
  { href: "/credit", label: "Credit", icon: Users },
];

export function QuickActions() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {ACTIONS.map((a) => {
        const Icon = a.icon;
        return (
          <Link
            key={a.href}
            href={a.href}
            className={`flex flex-col items-center justify-center gap-2 rounded-lg border p-4 text-center transition-colors ${
              a.primary
                ? "border-primary/40 bg-primary/10 hover:bg-primary/20"
                : "border-border bg-surface hover:bg-surface-2"
            }`}
          >
            <Icon className={`size-6 ${a.primary ? "text-primary-hover" : "text-muted-foreground"}`} />
            <span className="text-sm font-medium">{a.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
