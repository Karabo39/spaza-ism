"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store-context";
import { friendlyError } from "@/lib/format";

export function StartStockTakeButton() {
  const router = useRouter();
  const { store } = useStore();
  const [busy, setBusy] = React.useState(false);

  async function start() {
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("start_stock_take", { p_store: store.id });
    setBusy(false);
    if (error || !data) { toast.error(friendlyError(error?.message)); return; }
    router.push(`/stock-take/${data as string}`);
  }

  return <Button size="sm" loading={busy} onClick={start}><Plus className="size-4" /> Start stock take</Button>;
}
