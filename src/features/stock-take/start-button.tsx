"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store-context";
import { friendlyError } from "@/lib/format";
import { useOffline } from "@/lib/offline/offline-context";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export function StartStockTakeButton() {
  const router = useRouter();
  const { store, stores, setStore } = useStore();
  const [busy, setBusy] = React.useState(false);
  const [open, setOpen] = React.useState(false),
    [location, setLocation] = React.useState(store.id);
  const { online } = useOffline();

  async function start() {
    if (!online || busy) return;
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("start_stock_take", {
      p_store: location,
    });
    setBusy(false);
    if (error || !data) {
      toast.error(friendlyError(error?.message));
      return;
    }
    if (location !== store.id) setStore(location);
    setOpen(false);
    router.push(`/stock-take/${data as string}`);
  }

  return (
    <>
      <Button size="sm" disabled={!online} onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Start stock take
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Choose stock-take location</DialogTitle>
            <DialogDescription>
              Count a store or warehouse separately. Only your assigned
              locations are available.
            </DialogDescription>
          </DialogHeader>
          <label className="text-sm">
            Location
            <select
              className="mt-2 h-10 w-full rounded-md border border-border bg-input px-3"
              disabled={busy}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            >
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ·{" "}
                  {s.locationType === "warehouse" ? "Warehouse" : "Store"}
                </option>
              ))}
            </select>
          </label>
          <Button disabled={!online} loading={busy} onClick={start}>
            Start count at this location
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
