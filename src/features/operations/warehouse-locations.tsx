"use client";
import { WarehouseEdit } from "./warehouse-edit";
import { useOffline } from "@/lib/offline/offline-context";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store-context";
import { Button } from "@/components/ui/button";
import { money, qty } from "@/lib/format";

import type { ModuleKey } from "@/lib/modules";
export function WarehouseLocations({
  rows,
  opened = false,
}: {
  opened?: boolean;
  rows: {
    location_id: string;
    name: string;
    currency: string;
    code?: string | null;
    product_count: number;
    stock_quantity: number;
    stock_value: number;
  }[];
}) {
  const { stores } = useStore();
  const router = useRouter();
  const { online } = useOffline();
  const totals = rows.reduce<Record<string, number>>((all, row) => {
    all[row.currency] = (all[row.currency] || 0) + Number(row.stock_value);
    return all;
  }, {});
  const actions: { label: string; path: string; module: ModuleKey }[] = [
    { label: "View stock", path: "stock", module: "check_stock" },
    { label: "Receive stock", path: "receive", module: "goods_in_new_stock" },
    {
      label: "Unpack Bulk Stock",
      path: "unpack",
      module: "operations",
    },
    { label: "Transfer to Store", path: "transfers", module: "operations" },
    { label: "Adjust stock", path: "adjust", module: "adjust" },
    { label: "Stock take", path: "stock-take", module: "stock_take" },
    {
      label: "Movement reports",
      path: "movements",
      module: "reports",
    },
  ];
  return (
    <>
      <div className="mb-5 flex flex-wrap gap-4">
        {Object.entries(totals).map(([currency, total]) => (
          <p
            key={currency}
            className={`rounded-lg border p-4 ${total > 0 ? "border-success/40 bg-success/15 text-success" : "border-danger/40 bg-danger/15 text-danger"}`}
          >
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
            {opened && (
              <p className="text-xs text-muted">
                Code: {row.code || "Not set"}
              </p>
            )}
            {stores.some(
              (s) =>
                s.id === row.location_id &&
                s.role !== "employee" &&
                (s.modules.settings ||
                  s.modules.stores ||
                  s.modules.warehouse_disable),
            ) && (
              <WarehouseEdit
                id={row.location_id}
                name={row.name}
                code={row.code || ""}
                canEdit={stores.some(
                  (s) =>
                    s.id === row.location_id &&
                    (s.modules.settings || s.modules.stores),
                )}
                canDisable={
                  !!stores.find((s) => s.id === row.location_id)?.modules
                    .warehouse_disable
                }
              />
            )}
            <p>
              {row.product_count} products ·{" "}
              {opened && <>{qty(row.stock_quantity)} units · </>}
              {money(row.stock_value, row.currency)}
            </p>
            <div className="flex flex-wrap gap-2">
              {!opened ? (
                <Button
                  size="sm"
                  disabled={!online}
                  onClick={() => router.push(`/warehouse/${row.location_id}`)}
                >
                  Open Warehouse
                </Button>
              ) : (
                actions
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
                      className="bg-[#2c142b] hover:bg-[#402244] border-[#402244] text-white"
                      onClick={() => {
                        router.push(
                          a.path === "movements"
                            ? `/reports/warehouse-movements?warehouse=${row.location_id}`
                            : `/warehouse/${row.location_id}/${a.path}`,
                        );
                      }}
                    >
                      {a.label}
                    </Button>
                  ))
              )}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
