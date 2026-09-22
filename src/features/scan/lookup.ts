"use client";
import { createClient } from "@/lib/supabase/client";
import type { ProductStock } from "@/lib/db/database.types";
import { dataPage } from "@/lib/data-pages";
import { localFindByBarcode, localSearch } from "@/lib/offline/db";
export type LookupHit =
  | { product: ProductStock }
  | { notFound: true; code: string };
const isOffline = () => typeof navigator !== "undefined" && !navigator.onLine;
const networkFailure = (message: string) =>
  /fetch|network|failed to fetch/i.test(message);
export async function lookupByCode(
  storeId: string,
  rawCode: string,
): Promise<LookupHit> {
  const code = rawCode.trim();
  if (!code) return { notFound: true, code };
  if (!isOffline()) {
    const { data, error } = await createClient().rpc("resolve_product_code", {
      p_store: storeId,
      p_code: code,
    });
    if (!error)
      return data
        ? { product: data as unknown as ProductStock }
        : { notFound: true, code };
    if (!networkFailure(error.message)) throw error;
  }
  const local = await localFindByBarcode(storeId, code);
  return local ? { product: local } : { notFound: true, code };
}
export async function searchProducts(
  storeId: string,
  term: string,
  signal?: AbortSignal,
  itemType?: "Individual" | "Bulk Stock",
): Promise<ProductStock[]> {
  const t = term.trim();
  if (isOffline()) return localSearch(storeId, t, itemType);
  let query = createClient().rpc("catalog_page", {
    p_stores: [storeId],
    p_search: t,
    p_active: true,
    p_main_only: !itemType,
    p_item_type: itemType ?? null,
    p_limit: 20,
  });
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (signal?.aborted) throw new DOMException("Search cancelled", "AbortError");
  if (error) {
    if (networkFailure(error.message)) return localSearch(storeId, t, itemType);
    throw error;
  }
  return dataPage<ProductStock>(data).rows;
}
