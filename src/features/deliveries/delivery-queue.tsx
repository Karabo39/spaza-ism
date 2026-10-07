"use client";
import { useDeferredValue, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DeliveryStatus } from "./delivery-status";
import { dateOnly } from "@/lib/format";
import type { DeliveryRow } from "./types";
export function DeliveryQueue({ customerId }: { customerId?: string }) {
  const { store, canModule } = useStore();
  const [queue, setQueue] = useState("all"),
    [date, setDate] = useState(""),
    [search, setSearch] = useState(""),
    [cursors, setCursors] = useState<(number | undefined)[]>([undefined]);
  const deferredSearch = useDeferredValue(search);
  const cursor = cursors[cursors.length - 1];
  const query = useQuery({
    queryKey: [
      "billing",
      "delivery-queue",
      store.id,
      queue,
      date,
      deferredSearch,
      cursor,
      customerId,
    ],
    enabled: canModule("orders_deliveries"),
    queryFn: async () => {
      const { data, error } = await createClient().rpc("search_delivery_page", {
        p_store: store.id,
        p_queue: queue,
        p_date: date || undefined,
        p_after: cursor,
        p_customer: customerId,
        p_search: deferredSearch || undefined,
      });
      if (error) throw error;
      return data as unknown as { rows: DeliveryRow[] };
    },
  });
  if (!canModule("orders_deliveries")) return null;
  const rows = query.data?.rows.slice(0, 50) ?? [],
    more = (query.data?.rows.length ?? 0) > 50;
  return (
    <section className="space-y-4">
      <h2 className="font-semibold">
        {customerId ? "Delivery history" : "Deliveries"}
      </h2>
      <div className="flex flex-wrap items-end gap-3">
        <label>
          Queue
          <select
            className="block h-11 rounded border border-border bg-input p-2 sm:h-10"
            value={queue}
            onChange={(e) => {
              setQueue(e.target.value);
              setCursors([undefined]);
            }}
            aria-label="Delivery queue"
          >
            <option value="created">Created</option>
            <option value="current">Current delivery queue</option>
            <option value="scheduled">Scheduled</option>
            <option value="completed">Delivered</option>
            <option value="cancelled">Cancelled</option>
            <option value="all">All Deliveries</option>
          </select>
        </label>
        <label>
          Scheduled date
          <Input
            className="h-11 sm:h-10"
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setCursors([undefined]);
            }}
          />
        </label>
        {!customerId && <label className="min-w-[min(100%,18rem)] flex-1">
          Search deliveries
          <Input
            className="mt-1 h-11 sm:h-10"
            value={search}
            maxLength={128}
            onChange={(e) => {
              setSearch(e.target.value);
              setCursors([undefined]);
            }}
            placeholder="Enter all or part of a delivery number"
            aria-label="Search deliveries by delivery number"
          />
        </label>}
        <Button onClick={() => query.refetch()} disabled={query.isFetching}>
          Refresh
        </Button>
      </div>
      <p className="text-sm text-muted">
        Rescheduled deliveries stay in Scheduled until dispatched. Cancelled and
        delivered records remain available under All Deliveries and their status
        filters.
      </p>
      {query.isLoading && <p role="status">Loading deliveries…</p>}
      {query.error && (
        <p role="alert">Could not load deliveries. Please retry.</p>
      )}
      {!query.isLoading && !query.error && !rows.length && (
        <p>{search ? "No deliveries match this number." : "No deliveries in this queue."}</p>
      )}
      <div className="space-y-3">
        {rows.map((row) => (
          <article
            key={row.id}
            className="rounded-lg border border-border bg-surface p-4"
          >
            <div className="flex flex-wrap justify-between gap-3">
              <div>
                <p className="font-semibold">
                  {row.customer_name} · <DeliveryStatus status={row.status} />
                </p>
                <p className="text-sm break-all">
                  {row.reference} · Order {row.order_reference}
                </p>
                <p>
                  Scheduled:{" "}
                  {row.scheduled_date
                    ? dateOnly(row.scheduled_date)
                    : "Not scheduled"}
                  {row.driver_name && ` · Driver: ${row.driver_name}`}
                </p>
                <p className="whitespace-pre-wrap text-sm">
                  {row.delivery_address}
                </p>
                {row.cancellation_reason && (
                  <p>Cancelled: {row.cancellation_reason}</p>
                )}
              </div>
              <Button asChild>
                <Link href={`/orders/deliveries/${row.order_id}`}>
                  View delivery
                </Link>
              </Button>
            </div>
          </article>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          disabled={cursors.length === 1 || query.isFetching}
          onClick={() => setCursors(cursors.slice(0, -1))}
        >
          Previous
        </Button>
        <span>Page {cursors.length}</span>
        <Button
          variant="secondary"
          disabled={!more || query.isFetching}
          onClick={() =>
            setCursors([...cursors, rows[rows.length - 1].sequence])
          }
        >
          Next
        </Button>
      </div>
    </section>
  );
}
