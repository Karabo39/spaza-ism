import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import type { SaleReceipt } from "./payments";
/** Old immutable receipts predate customer snapshots; disclose the linked account's current name. */
export async function receiptCustomer(
  db: SupabaseClient<Database>,
  receipt: SaleReceipt,
  storeId: string,
): Promise<string | null> {
  if (receipt.customer_name) return receipt.customer_name;
  if (receipt.status !== "CREDIT") return null;
  const { data, error } = await db
    .from("goods_out")
    .select("customers(name)")
    .eq("id", receipt.id)
    .eq("store_id", storeId)
    .maybeSingle();
  if (error) throw error;
  const sale = data as unknown as { customers: { name: string } | null } | null;
  return sale?.customers?.name
    ? `${sale.customers.name} (current account name)`
    : null;
}
