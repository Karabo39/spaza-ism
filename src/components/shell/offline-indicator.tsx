"use client";
import * as React from "react";
import { WifiOff, RefreshCw, CloudUpload, AlertTriangle } from "lucide-react";
import { useOffline } from "@/lib/offline/offline-context";
import { OfflineQueueDialog } from "@/features/offline/queue-dialog";

/** Compact connectivity + pending-sync status for the top bar. Opens the queue. */
export function OfflineIndicator() {
  const { online, pending, failed, syncing } = useOffline();
  const [open, setOpen] = React.useState(false);

  let pill: React.ReactNode = null;

  if (!online) {
    pill = (
      <button onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning">
        <WifiOff className="size-3.5" /> Offline{pending > 0 ? ` · ${pending}` : ""}
      </button>
    );
  } else if (failed > 0) {
    pill = (
      <button onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-full border border-danger/40 bg-danger/10 px-2.5 py-1 text-xs font-medium text-danger">
        <AlertTriangle className="size-3.5" /> {failed} to review
      </button>
    );
  } else if (pending > 0 || syncing) {
    pill = (
      <button onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent">
        {syncing ? <RefreshCw className="size-3.5 animate-spin" /> : <CloudUpload className="size-3.5" />}
        {syncing ? "Syncing…" : `${pending} to sync`}
      </button>
    );
  }

  if (!pill) return null;
  return (
    <>
      {pill}
      <OfflineQueueDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
