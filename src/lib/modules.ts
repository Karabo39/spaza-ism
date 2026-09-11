import { MODULE_FEATURES } from "./module-features";
export { MODULE_FEATURES };
import type { MembershipRole } from "@/lib/db/database.types";

export const MODULES = [
  {
    key: "dashboard",
    label: "Dashboard",
    href: "/",
    role: "employee",
    group: "Daily work",
  },
  {
    key: "operations",
    label: "Transfers & unpacking",
    href: "/operations",
    role: "employee",
    group: "Catalogue",
  },
  {
    key: "goods_in",
    label: "Goods In",
    href: "/goods-in",
    role: "employee",
    group: "Daily work",
  },
  {
    key: "goods_out",
    label: "Goods Out",
    href: "/goods-out",
    role: "employee",
    group: "Daily work",
  },
  {
    key: "orders",
    label: "Orders",
    href: "/orders",
    role: "employee",
    group: "Daily work",
  },
  {
    key: "invoices",
    label: "Invoicing",
    href: "/invoices",
    role: "employee",
    group: "Daily work",
  },
  {
    key: "returns",
    label: "Goods Return",
    href: "/returns",
    role: "employee",
    group: "Daily work",
  },
  {
    key: "check_stock",
    label: "Check Stock",
    href: "/check-stock",
    role: "employee",
    group: "Stock",
  },
  {
    key: "check_price",
    label: "Check Price",
    href: "/check-price",
    role: "employee",
    group: "Stock",
  },
  {
    key: "credit",
    label: "Credit Customers",
    href: "/credit",
    role: "employee",
    group: "Daily work",
  },
  {
    key: "adjust",
    label: "Adjust Stock",
    href: "/adjust",
    role: "manager",
    group: "Stock",
  },
  {
    key: "stock_take",
    label: "Stock Take",
    href: "/stock-take",
    role: "employee",
    group: "Stock",
  },
  {
    key: "low_stock",
    label: "Low Stock",
    href: "/low-stock",
    role: "employee",
    group: "Stock",
  },
  {
    key: "expiry",
    label: "Expiry",
    href: "/expiry",
    role: "employee",
    group: "Stock",
  },
  {
    key: "products",
    label: "Products",
    href: "/products",
    role: "employee",
    group: "Catalogue",
  },
  {
    key: "suppliers",
    label: "Suppliers",
    href: "/suppliers",
    role: "employee",
    group: "Catalogue",
  },
  {
    key: "imports",
    label: "Data Imports and Exports",
    href: "/imports",
    role: "manager",
    group: "Catalogue",
  },
  {
    key: "reports",
    label: "Reports",
    href: "/reports",
    role: "employee",
    group: "Oversight",
  },
  {
    key: "cash_up",
    label: "Cash-up",
    href: "/cash-up",
    role: "employee",
    group: "Oversight",
  },
  {
    key: "users",
    label: "Users",
    href: "/users",
    role: "owner",
    group: "Administration",
  },
  {
    key: "audit",
    label: "Audit",
    href: "/audit",
    role: "manager",
    group: "Administration",
  },
  {
    key: "settings",
    label: "Settings",
    href: "/settings",
    role: "manager",
    group: "Administration",
  },
  {
    key: "stores",
    label: "My Stores",
    href: "/stores",
    role: "owner",
    group: "Administration",
  },
  {
    key: "access_control",
    label: "Access Control",
    href: "/access-control",
    role: "owner",
    group: "Administration",
  },
] as const;
export const PERMISSIONS = [...MODULES, ...MODULE_FEATURES] as const;
export type ModuleKey = (typeof PERMISSIONS)[number]["key"];
export type ModulePermissions = Record<ModuleKey, boolean>;
export const ROLE_RANK: Record<MembershipRole, number> = {
  employee: 1,
  manager: 2,
  owner: 3,
};

/** No row means the existing role defaults. A malformed row fails closed. */
export function permissionSettings(
  role: MembershipRole,
  overrides: unknown = {},
): ModulePermissions {
  const valid =
    !!overrides && typeof overrides === "object" && !Array.isArray(overrides);
  return Object.fromEntries(
    PERMISSIONS.map((m) => {
      const value = valid
        ? (overrides as Record<string, unknown>)[m.key]
        : false;
      return [
        m.key,
        role === "owner" ||
          (ROLE_RANK[role] >= ROLE_RANK[m.role] &&
            (value === undefined || value === true)),
      ];
    }),
  ) as ModulePermissions;
}
/** Effective permissions include the parent and linked-module requirements. */
export function modulePermissions(
  role: MembershipRole,
  overrides: unknown = {},
): ModulePermissions {
  const values = permissionSettings(role, overrides);
  const allowed = (key: ModuleKey): boolean => {
    if (!values[key]) return false;
    const feature = MODULE_FEATURES.find((f) => f.key === key);
    return (
      !feature || (allowed(feature.parent) && feature.requires.every(allowed))
    );
  };
  return Object.fromEntries(
    PERMISSIONS.map((p) => [p.key, allowed(p.key)]),
  ) as ModulePermissions;
}
export function moduleForPath(path: string): ModuleKey | undefined {
  const pathname = path.split("?")[0];
  return MODULES.find(
    (m) =>
      pathname === m.href ||
      (m.href !== "/" && pathname.startsWith(m.href + "/")),
  )?.key;
}
export function firstModulePath(permissions: ModulePermissions): string {
  return MODULES.find((m) => permissions[m.key])?.href ?? "/no-access";
}
