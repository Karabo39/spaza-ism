import { createClient } from "@/lib/supabase/client";
import type { ProductStock } from "@/lib/db/database.types";
import { localFindByBarcode, localSearch } from "@/lib/offline/db";

export type LookupHit = { product: ProductStock } | { notFound: true; code: string };

function isOffline() {
  return typeof navigator !== "undefined" && !navigator.onLine;
}

/**
 * Resolve a scanned/typed code to a product in the active store.
 * Online: exact barcode -> SKU -> id. Offline (or on network failure): the
 * local IndexedDB mirror is used so scanning still identifies products.
 */
export async function lookupByCode(storeId: string, rawCode: string): Promise<LookupHit> {
  const code = rawCode.trim();
  if (!code) return { notFound: true, code };

  if (isOffline()) {
    const local = await localFindByBarcode(storeId, code);
    return local ? { product: local } : { notFound: true, code };
  }

  try {
    const supabase = createClient();
    const { data: bc } = await supabase
      .from("product_barcodes")
      .select("product_id")
      .eq("store_id", storeId).eq("barcode", code).eq("is_active", true)
      .limit(1).maybeSingle();

    let productId = bc?.product_id ?? null;
    if (!productId) {
      const { data: bySku } = await supabase
        .from("products").select("id")
        .eq("store_id", storeId).eq("is_active", true).eq("sku", code)
        .limit(1).maybeSingle();
      productId = bySku?.id ?? null;
    }
    if (!productId) return { notFound: true, code };

    const { data: product } = await supabase
      .from("v_product_stock").select("*").eq("id", productId).maybeSingle();
    return product ? { product: product as ProductStock } : { notFound: true, code };
  } catch {
    // Network hiccup mid-request — fall back to the local mirror.
    const local = await localFindByBarcode(storeId, code);
    return local ? { product: local } : { notFound: true, code };
  }
}

/** Free-text product search for manual add within a store (offline-aware). */
export async function searchProducts(storeId: string, term: string): Promise<ProductStock[]> {
  const t = term.trim();
  if (isOffline()) return localSearch(storeId, t);
  try {
    const supabase = createClient();
    let query = supabase.from("v_product_stock").select("*").eq("store_id", storeId).eq("is_active", true);
    if (t) query = query.ilike("name", `%${t}%`);
    const { data } = await query.order("name").limit(20);
    return (data as ProductStock[]) ?? [];
  } catch {
    return localSearch(storeId, t);
  }
}
