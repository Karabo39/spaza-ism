"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import type { Session, SessionStore } from "@/lib/session";
import type { MembershipRole } from "@/lib/db/database.types";
import { ACTIVE_STORE_COOKIE } from "@/lib/constants";
import type { ModuleKey } from "@/lib/modules";
import { createClient } from "@/lib/supabase/client";

type StoreContextValue = {
  user: { id: string; email: string | null; fullName: string | null };
  stores: SessionStore[];
  store: SessionStore;
  role: MembershipRole;
  currency: string;
  setStore: (id: string) => void;
  can: (min: MembershipRole) => boolean;
  canModule: (module: ModuleKey) => boolean;
};

const StoreContext = React.createContext<StoreContextValue | null>(null);

const RANK: Record<MembershipRole, number> = {
  employee: 1,
  manager: 2,
  owner: 3,
};

export function StoreProvider({
  session,
  children,
}: {
  session: Session & { activeStore: SessionStore };
  children: React.ReactNode;
}) {
  const router = useRouter();
  React.useEffect(() => {
    let cancelled = false;
    let checking = false;
    let lastCheck = 0;
    const refresh = async () => {
      if (
        !navigator.onLine ||
        document.visibilityState !== "visible" ||
        checking ||
        Date.now() - lastCheck < 15000
      )
        return;
      checking = true;
      lastCheck = Date.now();
      try {
        const { data, error } = await createClient().rpc(
          "session_access_revision",
          {},
        );
        // Only rerender when access/profile/location metadata has changed.
        // RLS and mutation RPCs always enforce current grants independently.
        if (
          !cancelled &&
          ((!error && data !== session.accessRevision) ||
            error?.code === "PGRST301")
        )
          router.refresh();
      } catch {
        /* Keep the current view on transient network failure. */
      } finally {
        checking = false;
      }
    };
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    const interval = window.setInterval(refresh, 60000);
    return () => {
      cancelled = true;
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(interval);
    };
  }, [router, session.accessRevision]);

  const setStore = React.useCallback(
    (id: string) => {
      const next = session.stores.find((store) => store.id === id);
      if (!next) return;
      if (next.locationType === "warehouse") {
        router.push(`/warehouse/${id}/stock`);
        return;
      }
      if (!navigator.onLine) return;
      document.cookie = `${ACTIVE_STORE_COOKIE}=${id}; path=/; max-age=31536000; samesite=lax`;
      router.refresh();
    },
    [router, session.stores],
  );

  const value = React.useMemo<StoreContextValue>(
    () => ({
      user: {
        id: session.userId,
        email: session.email,
        fullName: session.fullName,
      },
      stores: session.stores,
      store: session.activeStore,
      role: session.activeStore.role,
      currency: session.activeStore.currency,
      setStore,
      can: (min) => RANK[session.activeStore.role] >= RANK[min],
      canModule: (module) =>
        session.activeStore.modules[module] === true ||
        (module === "warehouse" &&
          session.stores.some(
            (s) =>
              s.businessId === session.activeStore.businessId &&
              s.locationType === "warehouse" &&
              s.modules.warehouse,
          )),
    }),
    [session, setStore],
  );

  return (
    <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
  );
}

export function useStore() {
  const ctx = React.useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
