"use client";
import { createClient } from "@/lib/supabase/client";
import type { ProductStock } from "@/lib/db/database.types";
import {
  replaceProductMirror, listQueuedSales, removeQueuedSale, updateQueuedSale,
} from "./db";
import { friendlyError } from "@/lib/format";

/** Pull the store's products + barcodes into the local mirror (for offline use). */
export async function syncProductMirror(storeId: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return false;
  const supabase = createClient();
  const [{ data: products, error: pErr }, { data: barcodes, error: bErr }] = await Promise.all([
    supabase.from("v_product_stock").select("*").eq("store_id", storeId).limit(5000),
    supabase.from("product_barcodes").select("barcode, product_id, store_id").eq("store_id", storeId).eq("is_active", true).limit(10000),
  ]);
  if (pErr || bErr || !products) return false;
  await replaceProductMirror(storeId, products as ProductStock[], barcodes ?? []);
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
  if (typeof navigator !== "undefined" && !navigator.onLine) return { synced: 0, failed: 0 };
  const supabase = createClient();
  const queued = (await listQueuedSales(storeId)).filter((s) => s.status === "pending");
  let synced = 0, failed = 0;

  for (const sale of queued) {
    const { error } = await supabase.rpc("complete_sale", {
      p_store: sale.storeId,
      p_sale_type: "CASH",
      p_customer: null,
      p_items: sale.items,
      p_override: false,
    });
    if (!error) {
      await removeQueuedSale(sale.id);
      synced++;
    } else if (isNetworkError(error.message)) {
      // leave pending; will retry on next flush
      break;
    } else {
      await updateQueuedSale(sale.id, { status: "failed", error: friendlyError(error.message) });
      failed++;
    }
  }
  return { synced, failed };
}

function isNetworkError(message: string | undefined): boolean {
  const m = (message ?? "").toLowerCase();
  return m.includes("fetch") || m.includes("network") || m.includes("failed to") || m === "";
}
