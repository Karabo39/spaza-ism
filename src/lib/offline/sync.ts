"use client";
import { createClient } from "@/lib/supabase/client";

import {
  mirrorVersions,
  mergeProductMirror,
  type MirrorProduct,
  listQueuedSales,
  removeQueuedSale,
  updateQueuedSale,
} from "./db";
import { friendlyError } from "@/lib/format";

const inFlight = new Map<string, Promise<boolean>>();
/** Compare bounded version manifests, fetching only changed products and barcodes. */
export function syncProductMirror(storeId: string): Promise<boolean> {
  const running = inFlight.get(storeId);
  if (running) return running;
  const task = pullChanges(storeId).finally(() => inFlight.delete(storeId));
  inFlight.set(storeId, task);
  return task;
}
async function pullChanges(storeId: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return false;
  const supabase = createClient();
  const previous = await mirrorVersions(storeId);
  const versions: Record<string, string> = {};
  const products: MirrorProduct[] = [];
  let after: string | null = null;
  for (;;) {
    const { data, error } = await supabase.rpc("catalog_manifest", {
      p_store: storeId,
      p_after: after,
    });
    if (error || !Array.isArray(data))
      throw error ?? new Error("Invalid manifest");
    const page = data as { id: string; version: string }[];
    const changed = page.filter((r) => previous[r.id] !== r.version);
    for (const row of page) versions[row.id] = row.version;
    if (changed.length) {
      const response = await supabase.rpc("catalog_sync_products", {
        p_store: storeId,
        p_ids: changed.map((r) => r.id),
      });
      if (response.error || !Array.isArray(response.data))
        throw response.error ?? new Error("Invalid catalogue");
      const rows = response.data as unknown as MirrorProduct[];
      products.push(...rows);
      const returned = new Set(rows.map((r) => r.id));
      for (const row of changed)
        if (!returned.has(row.id)) delete versions[row.id];
    }
    if (page.length < 500) break;
    const next = page[page.length - 1].id;
    if (next === after) throw new Error("Manifest cursor did not advance");
    after = next;
  }
  await mergeProductMirror(storeId, products, versions);
  return true;
}

export type FlushResult = { synced: number; failed: number };

/**
 * Replay queued offline cash sales through complete_sale (the authoritative
 * RPC). Business failures (e.g. INSUFFICIENT_STOCK because stock changed) mark
 * the sale as "failed" for the operator to resolve; network failures leave it
 * pending to retry later.
 */
export async function flushSaleQueue(storeId: string): Promise<FlushResult> {
  if (typeof navigator !== "undefined" && !navigator.onLine)
    return { synced: 0, failed: 0 };
  const supabase = createClient();
  const queued = (await listQueuedSales(storeId)).filter(
    (s) => s.status === "pending",
  );
  let synced = 0,
    failed = 0;

  for (const sale of queued) {
    if (sale.actorId) {
      const { data, error } = await supabase.auth.getUser();
      if (error || data.user?.id !== sale.actorId) continue;
    }
    const { error } = sale.payments
      ? await supabase.rpc("complete_checkout", {
          p_store: sale.storeId,
          p_items: sale.items,
          p_payments: sale.payments,
          p_request: sale.id,
          p_customer: null,
          p_credit: false,
          p_override: false,
          p_till: sale.till ?? "",
        })
      : await supabase.rpc("complete_sale", {
          p_store: sale.storeId,
          p_sale_type: "CASH",
          p_customer: null,
          p_items: sale.items,
          p_override: false,
          p_request: sale.id,
        });
    if (!error) {
      await removeQueuedSale(sale.id);
      synced++;
    } else if (isNetworkError(error.message)) {
      // leave pending; will retry on next flush
      break;
    } else {
      await updateQueuedSale(sale.id, {
        status: "failed",
        error: friendlyError(error.message),
      });
      failed++;
    }
  }
  return { synced, failed };
}

function isNetworkError(message: string | undefined): boolean {
  const m = (message ?? "").toLowerCase();
  return (
    m.includes("fetch") ||
    m.includes("network") ||
    m.includes("failed to") ||
    m === ""
  );
}
