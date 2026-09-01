"use client";
import { WifiOff, RefreshCw, CloudUpload, AlertTriangle } from "lucide-react";
import { useOffline } from "@/lib/offline/offline-context";
import { cn } from "@/lib/utils";

/** Compact connectivity + pending-sync status for the top bar. */
export function OfflineIndicator() {
  const { online, pending, failed, syncing, syncNow } = useOffline();

  if (!online) {
    return (
      <span className="flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning">
        <WifiOff className="size-3.5" /> Offline{pending > 0 ? ` · ${pending}` : ""}
      </span>
    );
  }

  if (failed > 0) {
    return (
      <button onClick={() => void syncNow()}
        className="flex items-center gap-1.5 rounded-full border border-danger/40 bg-danger/10 px-2.5 py-1 text-xs font-medium text-danger">
        <AlertTriangle className="size-3.5" /> {failed} to review
      </button>
    );
  }

  if (pending > 0 || syncing) {
    return (
      <button onClick={() => void syncNow()} disabled={syncing}
        className="flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent">
        {syncing ? <RefreshCw className="size-3.5 animate-spin" /> : <CloudUpload className="size-3.5" />}
        {syncing ? "Syncing…" : `${pending} to sync`}
      </button>
    );
  }

  return null;
}
