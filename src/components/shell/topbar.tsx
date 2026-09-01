"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Menu as MenuIcon, ChevronsUpDown, LogOut, Check, User, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store-context";
import { Menu, MenuTrigger, MenuContent, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/dropdown";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { GlobalSearch } from "./global-search";

export function Topbar({ onMenu }: { onMenu: () => void }) {
  const router = useRouter();
  const { user, store, stores, role, setStore } = useStore();
  const [searchOpen, setSearchOpen] = React.useState(false);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  const initials = (user.fullName ?? user.email ?? "U")
    .split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/90 px-4 backdrop-blur">
      <button className="text-muted hover:text-foreground lg:hidden" onClick={onMenu} aria-label="Open menu">
        <MenuIcon className="size-5" />
      </button>

      <button
        onClick={() => setSearchOpen(true)}
        className="focus-ring hidden w-72 items-center gap-2 rounded-md border border-border bg-input px-3 py-2 text-sm text-muted hover:text-foreground sm:flex"
      >
        <Search className="size-4" />
        Search products, customers…
        <kbd className="ml-auto rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">/</kbd>
      </button>
      <button onClick={() => setSearchOpen(true)} className="text-muted hover:text-foreground sm:hidden" aria-label="Search">
        <Search className="size-5" />
      </button>

      <div className="ml-auto flex items-center gap-2">
        {/* Store switcher */}
        {stores.length > 1 ? (
          <Menu>
            <MenuTrigger className="focus-ring flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-sm hover:bg-surface-2">
              <span className="max-w-[10rem] truncate">{store.name}</span>
              <ChevronsUpDown className="size-3.5 text-muted" />
            </MenuTrigger>
            <MenuContent>
              <MenuLabel>Switch store</MenuLabel>
              {stores.map((s) => (
                <MenuItem key={s.id} onSelect={() => setStore(s.id)}>
                  <span className="flex-1 truncate">{s.name}</span>
                  <span className="text-xs text-muted">{s.businessName}</span>
                  {s.id === store.id ? <Check className="size-4 text-primary-hover" /> : null}
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>
        ) : (
          <Badge variant="neutral" className="hidden sm:inline-flex">{store.name}</Badge>
        )}

        {/* User menu */}
        <Menu>
          <MenuTrigger className="focus-ring flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-surface-2">
            <span className="flex size-8 items-center justify-center rounded-full bg-primary/20 text-xs font-semibold text-primary-hover">
              {initials}
            </span>
            <span className="hidden text-left sm:block">
              <span className="block max-w-[9rem] truncate text-sm font-medium leading-tight">{user.fullName}</span>
              <span className={cn("block text-[10px] capitalize leading-tight text-muted")}>{role}</span>
            </span>
          </MenuTrigger>
          <MenuContent>
            <MenuLabel>{user.email}</MenuLabel>
            <MenuSeparator />
            <MenuItem onSelect={() => router.push("/settings")}>
              <User className="size-4" /> Profile &amp; settings
            </MenuItem>
            <MenuItem onSelect={signOut} className="text-danger focus:text-danger">
              <LogOut className="size-4" /> Sign out
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>

      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </header>
  );
}
