import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import {
  Boxes, ArrowLeftRight, PackagePlus, PackageMinus, SlidersHorizontal, Wallet,
  TrendingUp, TrendingDown, CalendarClock, ClipboardList,
} from "lucide-react";

const REPORTS = [
  { href: "/reports/stock-valuation", label: "Stock Valuation", desc: "Current stock value by product", icon: Boxes },
  { href: "/reports/movements", label: "Stock Movements", desc: "Full stock ledger with filters", icon: ArrowLeftRight },
  { href: "/reports/goods-in", label: "Goods In", desc: "Stock received from suppliers", icon: PackagePlus },
  { href: "/reports/goods-out", label: "Goods Out", desc: "Cash and credit sales", icon: PackageMinus },
  { href: "/reports/adjustments", label: "Stock Adjustments", desc: "Corrections, damage, losses", icon: SlidersHorizontal },
  { href: "/reports/credit", label: "Customer Credit Balances", desc: "Who owes what", icon: Wallet },
  { href: "/reports/fast-moving", label: "Fast Moving", desc: "Top sellers by quantity", icon: TrendingUp },
  { href: "/reports/slow-moving", label: "Slow Moving", desc: "Products barely moving", icon: TrendingDown },
  { href: "/expiry", label: "Expiry", desc: "Approaching and expired stock", icon: CalendarClock },
  { href: "/low-stock", label: "Low Stock", desc: "Products needing reorder", icon: ClipboardList },
];

export default function ReportsPage() {
  return (
    <>
      <PageHeader title="Reports" crumbs={[{ label: "Insights" }, { label: "Reports" }]}
        description="Understand your stock, sales and credit without spreadsheets." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((r) => {
          const Icon = r.icon;
          return (
            <Link key={r.href} href={r.href}
              className="group flex items-start gap-3 rounded-lg border border-border bg-surface p-4 transition-colors hover:border-[#2a3a5c] hover:bg-surface-2">
              <div className="flex size-9 items-center justify-center rounded-md bg-surface-2 text-accent group-hover:bg-surface">
                <Icon className="size-4.5 size-5" />
              </div>
              <div>
                <p className="text-sm font-medium">{r.label}</p>
                <p className="text-xs text-muted">{r.desc}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}
