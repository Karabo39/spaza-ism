"use client";
import * as React from "react";
import { toast } from "sonner";
import { useStore } from "@/lib/store-context";
import { listQueuedSales } from "./db";
import { syncProductMirror, flushSaleQueue } from "./sync";

type OfflineValue = {
  online: boolean;
  pending: number;   // queued cash sales awaiting sync
  failed: number;    // queued sales that need attention
  syncing: boolean;
  syncNow: () => Promise<void>;
  refresh: () => Promise<void>;
};

const OfflineContext = React.createContext<OfflineValue | null>(null);

export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const { store } = useStore();
  const [online, setOnline] = React.useState(true);
  const [pending, setPending] = React.useState(0);
  const [failed, setFailed] = React.useState(0);
  const [syncing, setSyncing] = React.useState(false);
  const busy = React.useRef(false);

  const refresh = React.useCallback(async () => {
    const rows = await listQueuedSales(store.id);
    setPending(rows.filter((r) => r.status === "pending").length);
    setFailed(rows.filter((r) => r.status === "failed").length);
  }, [store.id]);

  const syncNow = React.useCallback(async () => {
    if (busy.current || (typeof navigator !== "undefined" && !navigator.onLine)) return;
    busy.current = true;
    setSyncing(true);
    try {
      await syncProductMirror(store.id);
      const { synced, failed } = await flushSaleQueue(store.id);
      await refresh();
      if (synced > 0) toast.success(`${synced} offline sale${synced === 1 ? "" : "s"} synced`);
      if (failed > 0) toast.error(`${failed} offline sale${failed === 1 ? "" : "s"} need attention`);
    } finally {
      setSyncing(false);
      busy.current = false;
    }
  }, [store.id, refresh]);

  // Initial: know connectivity, count queue, sync + mirror.
  React.useEffect(() => {
    setOnline(navigator.onLine);
    void refresh();
    if (navigator.onLine) void syncNow();
  }, [refresh, syncNow]);

  // Connectivity listeners.
  React.useEffect(() => {
    function goOnline() {
      setOnline(true);
      toast.success("Back online — syncing…");
      void syncNow();
    }
    function goOffline() {
      setOnline(false);
      toast.warning("You're offline. Cash sales will be saved and synced when you reconnect.");
    }
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [syncNow]);

  // Keep the mirror warm while online.
  React.useEffect(() => {
    const t = setInterval(() => { if (navigator.onLine) void syncProductMirror(store.id); }, 5 * 60_000);
    return () => clearInterval(t);
  }, [store.id]);

  const value = React.useMemo<OfflineValue>(
    () => ({ online, pending, failed, syncing, syncNow, refresh }),
    [online, pending, failed, syncing, syncNow, refresh],
  );

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

export function useOffline() {
  const ctx = React.useContext(OfflineContext);
  if (!ctx) throw new Error("useOffline must be used within OfflineProvider");
  return ctx;
}
