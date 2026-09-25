"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useStore } from "@/lib/store-context";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { MOVEMENT_META } from "@/features/stock/movement-meta";
import { dateTime, qty } from "@/lib/format";

export function RecentMovements() {
  const { store } = useStore();
  const [open, setOpen] = useState(false);
  const [cursors, setCursors] = useState<{ id: string; created_at: string }[]>(
    [],
  );
  const after = cursors.at(-1);
  const query = useQuery({
    queryKey: ["dashboard-movements", store.id, after],
    enabled: open && store.modules.dashboard_movements,
    queryFn: async ({ signal }) => {
      let request = createClient()
        .from("stock_movements")
        .select(
          "id,movement_type,quantity_delta,quantity_after,created_at,products(name)",
        )
        .eq("store_id", store.id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(21);
      if (after)
        request = request.or(
          `created_at.lt.${after.created_at},and(created_at.eq.${after.created_at},id.lt.${after.id})`,
        );
      const { data, error } = await request.abortSignal(signal);
      if (error) throw error;
      return data ?? [];
    },
  });
  const rows = query.data?.slice(0, 20) ?? [];
  return (
    <section className="rounded-lg border border-border bg-surface p-5 space-y-4">
      <h2>
        <Button
          aria-expanded={open}
          aria-controls="dashboard-movements"
          onClick={() => setOpen(!open)}
        >
          {open ? <ChevronDown /> : <ChevronRight />}Recent Stock Movements
        </Button>
      </h2>
      {open && (
        <div id="dashboard-movements" className="space-y-3">
          {query.isPending ? (
            <p role="status">Loading movements…</p>
          ) : query.isError ? (
            <p role="alert">
              Could not load movements.{" "}
              <Button variant="link" onClick={() => query.refetch()}>
                Retry
              </Button>
            </p>
          ) : !rows.length ? (
            <p>No stock movements yet.</p>
          ) : (
            <>
              <Table>
                <THead>
                  <TR>
                    <TH>Product</TH>
                    <TH>Type</TH>
                    <TH>Change</TH>
                    <TH>Balance</TH>
                    <TH>When</TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.map((row) => (
                    <TR key={row.id}>
                      <TD>
                        {(row.products as unknown as { name: string } | null)
                          ?.name ?? "—"}
                      </TD>
                      <TD>
                        <Badge
                          variant={
                            MOVEMENT_META[row.movement_type]?.variant ??
                            "neutral"
                          }
                        >
                          {MOVEMENT_META[row.movement_type]?.label ??
                            row.movement_type}
                        </Badge>
                      </TD>
                      <TD>{qty(row.quantity_delta)}</TD>
                      <TD>{qty(row.quantity_after)}</TD>
                      <TD>{dateTime(row.created_at)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              <nav
                aria-label="Movement pages"
                className="flex justify-between gap-3"
              >
                <Button
                  size="sm"
                  disabled={!after}
                  onClick={() => setCursors(cursors.slice(0, -1))}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  disabled={(query.data?.length ?? 0) <= 20}
                  onClick={() =>
                    setCursors([...cursors, rows[rows.length - 1]])
                  }
                >
                  Next
                </Button>
              </nav>
            </>
          )}
        </div>
      )}
    </section>
  );
}
