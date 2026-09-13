"use client";
import { useOffline } from "@/lib/offline/offline-context";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store-context";
import { Button } from "@/components/ui/button";
import { money, qty } from "@/lib/format";
import { LocationsManager } from "@/features/settings/locations-manager";
import type { ModuleKey } from "@/lib/modules";
export function WarehouseLocations({
  rows,
}: {
  rows: {
    location_id: string;
    name: string;
    currency: string;
    product_count: number;
    stock_quantity: number;
    stock_value: number;
  }[];
}) {
  const { stores, setStore } = useStore();
  const router = useRouter();
  const { online } = useOffline();
  const totals = rows.reduce<Record<string, number>>((all, row) => {
    all[row.currency] = (all[row.currency] || 0) + Number(row.stock_value);
    return all;
  }, {});
  const actions: { label: string; path: string; module: ModuleKey }[] = [
    { label: "View stock", path: "/check-stock", module: "check_stock" },
    { label: "Receive stock", path: "/goods-in", module: "goods_in" },
    { label: "Transfers", path: "/operations/transfers", module: "operations" },
    { label: "Adjust stock", path: "/adjust", module: "adjust" },
    { label: "Stock take", path: "/stock-take", module: "stock_take" },
    {
      label: "Movement reports",
      path: "/reports/movements",
      module: "reports",
    },
  ];
  return (
    <>
      <div className="mb-5 flex flex-wrap gap-4">
        {Object.entries(totals).map(([currency, total]) => (
          <p key={currency} className="rounded-lg border border-border p-4">
            Total warehouse value: <strong>{money(total, currency)}</strong>
          </p>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {rows.map((row) => (
          <section
            key={row.location_id}
            className="space-y-3 rounded-lg border border-border bg-surface p-4"
          >
            <h2 className="text-lg font-semibold">{row.name}</h2>
            <p>
              {row.product_count} products · {qty(row.stock_quantity)} units ·{" "}
              {money(row.stock_value, row.currency)}
            </p>
            <div className="flex flex-wrap gap-2">
              {actions
                .filter(
                  (a) =>
                    stores.find((s) => s.id === row.location_id)?.modules[
                      a.module
                    ],
                )
                .map((a) => (
                  <Button
                    disabled={!online}
                    key={a.path}
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setStore(row.location_id);
                      router.push(a.path);
                    }}
                  >
                    {a.label}
                  </Button>
                ))}
            </div>
          </section>
        ))}
      </div>
      <LocationsManager locationType="warehouse" activateOnCreate />
    </>
  );
}
