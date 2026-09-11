"use client";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "@/lib/store-context";
import { useOffline } from "@/lib/offline/offline-context";
import { createClient } from "@/lib/supabase/client";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { money, qty, friendlyError } from "@/lib/format";

export function LocationOverview() {
  const { store, stores, can, canModule, setStore } = useStore();
  const { online } = useOffline();
  const allowed = can("owner") && canModule("dashboard_locations");
  const { data, isLoading, error } = useQuery({
    queryKey: ["location-overview", store.businessId],
    enabled: allowed && online,
    queryFn: async () => {
      const { data, error } = await createClient().rpc(
        "business_location_summary",
        { p_business: store.businessId },
      );
      if (error) throw error;
      return data;
    },
  });
  if (!allowed) return null;
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>All business locations</CardTitle>
        <CardDescription>
          Stock held at each store and warehouse. Warehouse stock is separate
          from stock available for sale.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!online ? (
          <p className="text-sm text-muted">
            Connect to see current stock across your business.
          </p>
        ) : error ? (
          <p role="alert" className="text-sm text-danger">
            {friendlyError(error.message)}
          </p>
        ) : isLoading ? (
          <p className="text-sm text-muted">Loading locations…</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Location</TH>
                <TH>Type</TH>
                <TH className="text-right">Products</TH>
                <TH className="text-right">Quantity</TH>
                <TH className="text-right">Cost value</TH>
              </TR>
            </THead>
            <TBody>
              {(data ?? []).map((s) => (
                <TR key={s.location_id}>
                  <TD>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setStore(s.location_id)}
                    >
                      {s.name}
                      {s.location_id === store.id ? " (active)" : ""}
                    </Button>
                  </TD>
                  <TD className="capitalize">{s.location_type}</TD>
                  <TD className="text-right tabular-nums">{s.product_count}</TD>
                  <TD className="text-right tabular-nums">
                    {qty(s.stock_quantity)}
                  </TD>
                  <TD className="text-right tabular-nums">
                    {stores.find((location) => location.id === s.location_id)
                      ?.currency
                      ? money(
                          s.stock_value,
                          stores.find(
                            (location) => location.id === s.location_id,
                          )!.currency,
                        )
                      : "Currency unavailable"}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
