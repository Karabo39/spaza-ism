"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store-context";
import { useOffline } from "@/lib/offline/offline-context";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { friendlyError } from "@/lib/format";
export function WarehouseStateButton({ active }: { active: boolean }) {
  const { store } = useStore(),
    { online } = useOffline(),
    router = useRouter();
  const [busy, setBusy] = useState(false),
    lock = useRef(false);
  if (!store.modules.warehouse_disable) return null;
  return (
    <Button
      loading={busy}
      disabled={!online}
      onClick={async () => {
        if (lock.current) return;
        lock.current = true;
        setBusy(true);
        try {
          const { error } = await createClient().rpc(
            active ? "disable_warehouse" : "enable_warehouse",
            { p_store: store.id },
          );
          if (error) throw error;
          toast.success(active ? "Warehouse disabled" : "Warehouse enabled");
          router.refresh();
        } catch (e) {
          toast.error(friendlyError((e as Error).message));
        } finally {
          lock.current = false;
          setBusy(false);
        }
      }}
    >
      {active ? "Disable Warehouse" : "Enable Warehouse"}
    </Button>
  );
}
