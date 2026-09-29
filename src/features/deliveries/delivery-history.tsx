"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { dateTime } from "@/lib/format";
import { statusLabel } from "@/features/billing/status-label";
export function DeliveryHistory({ id }: { id: string }) {
  const [pages, setPages] = useState<(number | undefined)[]>([undefined]);
  const cursor = pages.at(-1);
  const query = useQuery({
    queryKey: ["billing", "delivery-history", id, cursor],
    queryFn: async () => {
      let request = createClient()
        .from("delivery_events")
        .select(
          "id,action,actor_name,created_at,notes,before_date:before_data->>scheduled_date,after_date:after_data->>scheduled_date,original_date:after_data->>date,cancellation_reason:after_data->>cancellation_reason",
        )
        .eq("delivery_id", id)
        .order("id", { ascending: false })
        .limit(26);
      if (cursor) request = request.lt("id", cursor);
      const { data, error } = await request;
      if (error) throw error;
      return data;
    },
  });
  const rows = query.data?.slice(0, 25) ?? [];
  return (
    <section className="space-y-3">
      <h3 className="font-semibold">Delivery activity</h3>
      {query.error && <p role="alert">Could not load history.</p>}
      {rows.map((e) => {
        const before = e.before_date as string | null,
          after = (e.after_date || e.original_date) as string | null;
        return (
          <article key={e.id} className="border-l-2 border-border pl-3">
            <p>
              {statusLabel(e.action)} · {dateTime(e.created_at)} ·{" "}
              {e.actor_name}
            </p>
            {after && (
              <p className="text-sm">
                Scheduled: {before && before !== after ? `${before} → ` : ""}
                {after}
              </p>
            )}
            {e.cancellation_reason && (
              <p>Reason: {String(e.cancellation_reason)}</p>
            )}
            {e.notes && (
              <p className="whitespace-pre-wrap text-sm">{e.notes}</p>
            )}
          </article>
        );
      })}
      <div className="flex gap-3">
        <Button
          variant="secondary"
          disabled={pages.length === 1 || query.isFetching}
          onClick={() => setPages(pages.slice(0, -1))}
        >
          Newer activity
        </Button>
        <Button
          variant="secondary"
          disabled={(query.data?.length ?? 0) <= 25 || query.isFetching}
          onClick={() => setPages([...pages, rows.at(-1)!.id])}
        >
          Older activity
        </Button>
      </div>
    </section>
  );
}
