import {
  LayoutDashboard, PackagePlus, PackageMinus, Search, Tag, Users, SlidersHorizontal,
  ClipboardList, TriangleAlert, Boxes, Truck, BarChart3, UserCog, Settings, ScrollText,
  CalendarClock,
  type LucideIcon,
} from "lucide-react";
import type { MembershipRole } from "@/lib/db/database.types";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  minRole?: MembershipRole; // hide below this role
};

export type NavGroup = { label: string; items: NavItem[] };

export const NAV: NavGroup[] = [
  {
    label: "Operations",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/goods-in", label: "Goods In", icon: PackagePlus },
      { href: "/goods-out", label: "Goods Out", icon: PackageMinus },
      { href: "/check-stock", label: "Check Stock", icon: Search },
      { href: "/check-price", label: "Check Price", icon: Tag },
      { href: "/credit", label: "Credit Customers", icon: Users },
    ],
  },
  {
    label: "Stock Control",
    items: [
      { href: "/adjust", label: "Adjust Stock", icon: SlidersHorizontal, minRole: "manager" },
      { href: "/stock-take", label: "Stock Take", icon: ClipboardList },
      { href: "/low-stock", label: "Low Stock", icon: TriangleAlert },
      { href: "/expiry", label: "Expiry", icon: CalendarClock },
    ],
  },
  {
    label: "Catalog",
    items: [
      { href: "/products", label: "Products", icon: Boxes },
      { href: "/suppliers", label: "Suppliers", icon: Truck },
    ],
  },
  {
    label: "Insights",
    items: [{ href: "/reports", label: "Reports", icon: BarChart3 }],
  },
  {
    label: "Administration",
    items: [
      { href: "/users", label: "Users", icon: UserCog, minRole: "owner" },
      { href: "/audit", label: "Audit", icon: ScrollText, minRole: "manager" },
      { href: "/settings", label: "Settings", icon: Settings, minRole: "manager" },
    ],
  },
];

const RANK: Record<MembershipRole, number> = { employee: 1, manager: 2, owner: 3 };
export function itemVisible(item: NavItem, role: MembershipRole): boolean {
  return !item.minRole || RANK[role] >= RANK[item.minRole];
}
