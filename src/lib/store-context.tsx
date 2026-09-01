"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import type { Session, SessionStore } from "@/lib/session";
import type { MembershipRole } from "@/lib/db/database.types";
import { ACTIVE_STORE_COOKIE } from "@/lib/constants";

type StoreContextValue = {
  user: { id: string; email: string | null; fullName: string | null };
  stores: SessionStore[];
  store: SessionStore;
  role: MembershipRole;
  currency: string;
  setStore: (id: string) => void;
  can: (min: MembershipRole) => boolean;
};

const StoreContext = React.createContext<StoreContextValue | null>(null);

const RANK: Record<MembershipRole, number> = { employee: 1, manager: 2, owner: 3 };

export function StoreProvider({
  session,
  children,
}: {
  session: Session & { activeStore: SessionStore };
  children: React.ReactNode;
}) {
  const router = useRouter();

  const setStore = React.useCallback(
    (id: string) => {
      document.cookie = `${ACTIVE_STORE_COOKIE}=${id}; path=/; max-age=31536000; samesite=lax`;
      router.refresh();
    },
    [router],
  );

  const value = React.useMemo<StoreContextValue>(
    () => ({
      user: { id: session.userId, email: session.email, fullName: session.fullName },
      stores: session.stores,
      store: session.activeStore,
      role: session.activeStore.role,
      currency: session.activeStore.currency,
      setStore,
      can: (min) => RANK[session.activeStore.role] >= RANK[min],
    }),
    [session, setStore],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = React.useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
