"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShieldCheck, X } from "lucide-react";
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
  const { role, store } = useStore();

  return (
    <>
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={onClose} aria-hidden />
      ) : null}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border bg-sidebar transition-transform lg:static lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-14 items-center justify-between gap-2 border-b border-border px-4">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <ShieldCheck className="size-4" />
            </div>
            <div className="leading-tight">
              <p className="text-sm font-semibold">Spaza ISM</p>
              <p className="text-[10px] text-muted">Inventory Control</p>
            </div>
          </Link>
          <button className="text-muted hover:text-foreground lg:hidden" onClick={onClose}>
            <X className="size-5" />
          </button>
        </div>

        <div className="border-b border-border px-4 py-3">
          <p className="text-[10px] uppercase tracking-wide text-muted">Active store</p>
          <p className="truncate text-sm font-medium">{store.name}</p>
          <p className="truncate text-xs text-muted">{store.businessName}</p>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {NAV.map((group) => {
            const items = group.items.filter((i) => itemVisible(i, role));
            if (items.length === 0) return null;
            return (
              <div key={group.label} className="mb-4">
                <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted/70">
                  {group.label}
                </p>
                <ul className="space-y-0.5">
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
                          <Icon className={cn("size-4 shrink-0", active && "text-primary-hover")} />
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
