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
      const { data, error } = await createClient().rpc("returnable_documents", {
        p_store: store.id,
        p_type: sourceType,
      });
      if (error) throw error;
      return (
        data as unknown as {
          id: string;
          created_at: string;
          reference: string;
          customer_name: string;
          total: number;
          items: { name: string; remaining: number }[];
        }[]
      ).map((d) => ({
        id: d.id,
        label: `${dateTime(d.created_at)} · ${d.customer_name} · ${money(d.total, currency)} · ${d.items.map((i) => `${i.remaining} × ${i.name} remaining`).join(", ")} · ${d.reference.slice(-6)}`,
      }));
    },
  });
}
