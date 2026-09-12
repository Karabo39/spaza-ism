"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X, ChevronDown, ChevronRight } from "lucide-react";
import { BusinessLogo } from "@/features/settings/business-logo";
import { BrandLogo } from "@/components/brand-logo";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store-context";
import { NAV, itemVisible } from "./nav-config";

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function Sidebar({
  mobileOpen,
  onClose,
}: {
  mobileOpen: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const { role, store, user, canModule } = useStore();

  const storageKey = `pos-navigation:${user.id}:${store.businessId}`;
  const subscribe = React.useCallback((notify: () => void) => {
    window.addEventListener("storage", notify);
    window.addEventListener("pos-navigation-change", notify);
    return () => {
      window.removeEventListener("storage", notify);
      window.removeEventListener("pos-navigation-change", notify);
    };
  }, []);
  const [memory, setMemory] = React.useState<{
    key: string;
    value: string;
  } | null>(null);
  const saved = React.useSyncExternalStore(
    subscribe,
    () => {
      try {
        return localStorage.getItem(storageKey) ?? "[]";
      } catch {
        return "[]";
      }
    },
    () => "[]",
  );
  let collapsed: string[] = [];
  try {
    const value: unknown = JSON.parse(
      memory?.key === storageKey ? memory.value : saved,
    );
    if (Array.isArray(value))
      collapsed = value.filter((v): v is string => typeof v === "string");
  } catch {
    /* Invalid preferences use expanded sections. */
  }
  function toggle(label: string) {
    const next = collapsed.includes(label)
      ? collapsed.filter((v) => v !== label)
      : [...collapsed, label];
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      setMemory({ key: storageKey, value: JSON.stringify(next) });
    }
    window.dispatchEvent(new Event("pos-navigation-change"));
  }
  const dashboard = NAV.flatMap((g) => g.items).find((i) => i.href === "/");
  return (
    <>
      {mobileOpen ? (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={onClose}
          aria-hidden
        />
      ) : null}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex h-dvh w-64 shrink-0 flex-col overflow-hidden border-r border-border bg-sidebar transition-transform lg:static lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
          <Link
            href="/"
            aria-label={`${store.businessName} home`}
            onClick={onClose}
            className="flex items-center gap-2.5"
          >
            <BusinessLogo />
            <div className="leading-tight">
              <BrandLogo variant="wordmark" />
              <p className="text-[10px] text-muted">Inventory Control</p>
            </div>
          </Link>
          <button
            aria-label="Close menu"
            className="text-muted hover:text-foreground lg:hidden"
            onClick={onClose}
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="shrink-0 border-b border-border px-4 py-3">
          <p className="text-[10px] uppercase tracking-wide text-muted">
            Active {store.locationType === "warehouse" ? "warehouse" : "store"}
          </p>
          <p className="truncate text-sm font-medium">{store.name}</p>
          <p className="truncate text-xs text-muted">{store.businessName}</p>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-3">
          {dashboard && itemVisible(dashboard, role, canModule) && (
            <Link
              href="/"
              onClick={onClose}
              className={cn(
                "mb-4 flex items-center gap-3 rounded-md px-3 py-2 text-sm",
                pathname === "/"
                  ? "bg-primary/15 font-medium text-foreground"
                  : "text-muted-foreground hover:bg-surface-2",
              )}
            >
              <dashboard.icon className="size-4" />
              {dashboard.label}
            </Link>
          )}
          {NAV.map((group) => {
            const items = group.items.filter(
              (i) => i.href !== "/" && itemVisible(i, role, canModule),
            );
            if (items.length === 0) return null;
            return (
              <div key={group.label} className="mb-4">
                <button
                  type="button"
                  aria-expanded={!collapsed.includes(group.label)}
                  aria-controls={`nav-${group.label.replaceAll(" ", "-")}`}
                  onClick={() => toggle(group.label)}
                  className="flex w-full items-center justify-between rounded px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted/70 focus-visible:outline-2 focus-visible:outline-primary"
                >
                  {group.label}
                  {collapsed.includes(group.label) ? (
                    <ChevronRight className="size-3.5" />
                  ) : (
                    <ChevronDown className="size-3.5" />
                  )}
                </button>
                <ul
                  id={`nav-${group.label.replaceAll(" ", "-")}`}
                  hidden={collapsed.includes(group.label)}
                  className="space-y-0.5"
                >
                  {items.map((item) => {
                    const active = isActive(pathname, item.href);
                    const Icon = item.icon;
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          onClick={onClose}
                          className={cn(
                            "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                            active
                              ? "bg-primary/15 font-medium text-foreground"
                              : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
                          )}
                        >
                          <Icon
                            className={cn(
                              "size-4 shrink-0",
                              active && "text-primary-hover",
                            )}
                          />
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
