"use client";
import * as React from "react";
import { toast } from "sonner";
import { RefreshCw, Trash2, CloudUpload, CheckCircle2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/misc";
import { useStore } from "@/lib/store-context";
import { useOffline } from "@/lib/offline/offline-context";
import { listQueuedSales, updateQueuedSale, removeQueuedSale, localFindById, type QueuedSale } from "@/lib/offline/db";
import { money, dateTime } from "@/lib/format";

type Row = QueuedSale & { names: string; count: number };

export function OfflineQueueDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { store, currency } = useStore();
  const { online, syncing, syncNow, refresh } = useOffline();
  const [rows, setRows] = React.useState<Row[]>([]);
  const [loading, setLoading] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    const q = await listQueuedSales(store.id);
    const withNames = await Promise.all(
      q.map(async (s) => {
        const names = (
          await Promise.all(s.items.map(async (i) => (await localFindById(i.product_id))?.name ?? "Item"))
        ).join(", ");
        return { ...s, names, count: s.items.reduce((n, i) => n + Number(i.quantity), 0) };
      }),
    );
    setRows(withNames);
    setLoading(false);
  }, [store.id]);

  React.useEffect(() => { if (open) void load(); }, [open, load]);

  async function retry(id: string) {
    await updateQueuedSale(id, { status: "pending", error: undefined });
    await syncNow();
    await load();
    await refresh();
  }
  async function discard(id: string) {
    await removeQueuedSale(id);
    toast.success("Removed from the offline queue");
    await load();
    await refresh();
  }
  async function syncAll() {
    await syncNow();
    await load();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Offline sales</DialogTitle>
          <DialogDescription>
            Cash sales captured without a connection. They sync automatically when you&apos;re back online.
          </DialogDescription>
        </DialogHeader>

        {rows.length === 0 ? (
          <EmptyState icon={CheckCircle2} title="Nothing queued"
            description="All offline sales have synced." />
        ) : (
          <>
            <div className="max-h-80 space-y-2 overflow-y-auto">
              {rows.map((r) => (
                <div key={r.id} className="rounded-md border border-border bg-surface-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{r.names}</p>
                      <p className="text-xs text-muted">{r.count} item{r.count === 1 ? "" : "s"} · {dateTime(new Date(r.createdAt))}</p>
                      {r.status === "failed" && r.error ? (
                        <p className="mt-1 text-xs text-danger">{r.error}</p>
                      ) : null}
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold tabular-nums">{money(r.total, currency)}</p>
                      {r.status === "failed"
                        ? <Badge variant="danger">Needs review</Badge>
                        : <Badge variant="accent">Pending</Badge>}
                    </div>
                  </div>
                  <div className="mt-2 flex justify-end gap-2">
                    {r.status === "failed" ? (
                      <Button size="sm" variant="secondary" onClick={() => retry(r.id)} disabled={!online || syncing}>
                        <RefreshCw className="size-3.5" /> Retry
                      </Button>
                    ) : null}
                    <Button size="sm" variant="ghost" className="text-muted hover:text-danger" onClick={() => discard(r.id)}>
                      <Trash2 className="size-3.5" /> Discard
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end border-t border-border pt-3">
              <Button size="sm" onClick={syncAll} loading={syncing} disabled={!online || loading}>
                <CloudUpload className="size-4" /> Sync now
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
