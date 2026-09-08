"use client";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { money, dateTime } from "@/lib/format";

export function useReturnSources(
  store: { id: string },
  sourceType: string,
  currency: string,
) {
  return useQuery({
    queryKey: ["billing", "return-sources", store.id, sourceType],
    queryFn: async () => {
      const db = createClient();
      if (sourceType === "invoice") {
        const { data, error } = await db
          .from("sales_invoices")
          .select("id,reference,customer_name,total,created_at")
          .eq("store_id", store.id)
          .not("goods_issued_at", "is", null)
          .order("created_at", { ascending: false })
          .limit(100);
        if (error) throw error;
        const ids = (data ?? []).map((i) => i.id);
        const { data: items, error: itemError } = ids.length
          ? await db
              .from("sales_invoice_items")
              .select("invoice_id,product_name,quantity")
              .in("invoice_id", ids)
          : { data: [], error: null };
        if (itemError) throw itemError;
        return (data ?? []).map((i) => ({
          id: i.id,
          label: `${dateTime(i.created_at)} · ${i.customer_name} · ${money(i.total, currency)} · ${(
            items ?? []
          )
            .filter((l) => l.invoice_id === i.id)
            .map((l) => `${l.quantity} × ${l.product_name}`)
            .join(", ")} · ${i.reference.slice(-6)}`,
        }));
      }
      const { data, error } = await db
        .from("goods_out")
        .select("id,created_at,total_amount")
        .eq("store_id", store.id)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      const ids = (data ?? []).map((s) => s.id);
      const { data: sold, error: soldError } = ids.length
        ? await db
            .from("goods_out_items")
            .select("goods_out_id,product_id,quantity")
            .in("goods_out_id", ids)
        : { data: [], error: null };
      if (soldError) throw soldError;
      const productIds = [...new Set((sold ?? []).map((l) => l.product_id))];
      const { data: names, error: namesError } = productIds.length
        ? await db.from("products").select("id,name").in("id", productIds)
        : { data: [], error: null };
      if (namesError) throw namesError;
      const nameById = new Map((names ?? []).map((p) => [p.id, p.name]));
      const labels = new Map<string, string[]>();
      for (const line of sold ?? []) {
        const group = labels.get(line.goods_out_id) ?? [];
        group.push(
          `${line.quantity} \u00d7 ${nameById.get(line.product_id) ?? "Product"}`,
        );
        labels.set(line.goods_out_id, group);
      }
      return (data ?? []).map((s) => ({
        id: s.id,
        label: `${dateTime(s.created_at)} · ${money(s.total_amount, currency)} · ${(labels.get(s.id) ?? []).join(", ")} · ${s.id.slice(-6)}`,
      }));
    },
  });
}
