"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useOffline } from "@/lib/offline/offline-context";
import { friendlyError } from "@/lib/format";
export function useBillingAction() {
  const { online } = useOffline();
  const [busy, setBusy] = useState(false);
  // State disables the button; this ref also closes the gap before React renders.
  const inFlight = useRef(false);
  const ids = useRef(new Map<string, string>());
  const pendingKey = useRef<string | null>(null);
  const activeKeys = useRef<Set<string> | null>(null);
  const router = useRouter();
  const cache = useQueryClient();
  function request(payload: unknown) {
    const key = JSON.stringify(payload);
    if (!ids.current.has(key)) ids.current.set(key, crypto.randomUUID());
    if (activeKeys.current) activeKeys.current.add(key);
    else pendingKey.current = key;
    return ids.current.get(key)!;
  }
  async function run(
    action: () => PromiseLike<{ error: { message: string } | null }>,
    message: string,
    onSuccess?: () => void,
  ) {
    if (!online || inFlight.current) return;
    inFlight.current = true;
    activeKeys.current = new Set(
      pendingKey.current ? [pendingKey.current] : [],
    );
    pendingKey.current = null;
    setBusy(true);
    let confirmed = false;
    try {
      const { error } = await action();
      if (error) {
        toast.error(friendlyError(error.message));
        return;
      }
      confirmed = true;
      // A successful action must not invalidate another uncertain payment's ID.
      for (const key of activeKeys.current) ids.current.delete(key);
      toast.success(message);
      onSuccess?.();
      router.refresh();
      await cache.invalidateQueries({ queryKey: ["billing"] });
    } catch {
      toast.error(
        confirmed
          ? "Saved successfully. Refresh to see the latest records."
          : "Couldn't confirm the result. Reconnect and retry with the same details.",
      );
    } finally {
      activeKeys.current = null;
      inFlight.current = false;
      setBusy(false);
    }
  }
  return { online, busy, request, run };
}
