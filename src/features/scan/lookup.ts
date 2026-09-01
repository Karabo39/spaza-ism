import { createClient } from "@/lib/supabase/client";
import type { ProductStock } from "@/lib/db/database.types";

export type LookupHit = { product: ProductStock } | { notFound: true; code: string };

/**
 * Resolve a scanned/typed code to a product in the active store.
 * Order: exact barcode -> exact SKU -> exact name. Returns notFound otherwise.
 */
export async function lookupByCode(storeId: string, rawCode: string): Promise<LookupHit> {
  const code = rawCode.trim();
  if (!code) return { notFound: true, code };
  const supabase = createClient();

  const { data: bc } = await supabase
    .from("product_barcodes")
    .select("product_id")
    .eq("store_id", storeId)
    .eq("barcode", code)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  let productId = bc?.product_id ?? null;

  if (!productId) {
    const { data: bySku } = await supabase
      .from("products")
      .select("id")
      .eq("store_id", storeId)
      .eq("is_active", true)
      .eq("sku", code)
      .limit(1)
      .maybeSingle();
    productId = bySku?.id ?? null;
  }

  if (!productId) return { notFound: true, code };

  const { data: product } = await supabase
    .from("v_product_stock")
    .select("*")
    .eq("id", productId)
    .maybeSingle();

  if (!product) return { notFound: true, code };
  return { product: product as ProductStock };
}

/** Free-text product search for manual add within a store. */
export async function searchProducts(storeId: string, term: string): Promise<ProductStock[]> {
  const t = term.trim();
  const supabase = createClient();
  let query = supabase.from("v_product_stock").select("*").eq("store_id", storeId).eq("is_active", true);
  if (t) query = query.ilike("name", `%${t}%`);
  const { data } = await query.order("name").limit(20);
  return (data as ProductStock[]) ?? [];
}
