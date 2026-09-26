"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Store, Warehouse, ArrowRight } from "lucide-react";
import { useStore } from "@/lib/store-context";
import { useOffline } from "@/lib/offline/offline-context";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { money } from "@/lib/format";

export function MyStores() {
  const { store, stores } = useStore();
  const { online } = useOffline();
  const overview = useQuery({
    queryKey: [
      "store-setup",
      store.businessId,
      stores.map((s) => s.id).join(","),
    ],
    enabled: online,
    queryFn: async () => {
      const db = createClient();
      const [{ data: totals }, { data: assignments }, { data: members }] =
        await Promise.all([
          db
            .rpc("business_location_summary", { p_business: store.businessId })
            .throwOnError(),
          db
            .from("store_memberships")
            .select("store_id, membership_id")
            .eq("business_id", store.businessId)
            .throwOnError(),
          db
            .from("memberships")
            .select("id")
            .eq("business_id", store.businessId)
            .eq("is_active", true)
            .neq("role", "owner")
            .throwOnError(),
        ]);
      return (totals ?? []).map((s) => ({
        ...s,
        staff:
          assignments?.filter(
            (a) =>
              a.store_id === s.location_id &&
              members?.some((m) => m.id === a.membership_id),
          ).length ?? 0,
      }));
    },
  });
  return (
    <div className="space-y-6">
      {!online ? (
        <p role="status" className="text-sm text-warning">
          Connect to add stores or see current setup progress.
        </p>
      ) : overview.error ? (
        <p role="alert" className="text-danger">
          Could not load store details.{" "}
          <Button variant="ghost" onClick={() => overview.refetch()}>
            Try again
          </Button>
        </p>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {stores
          .filter(
            (s) =>
              s.businessId === store.businessId && s.locationType === "store",
          )
          .map((s) => {
            const active = s.id === store.id;
            const totals = overview.data?.find((t) => t.location_id === s.id);
            const Icon = s.locationType === "warehouse" ? Warehouse : Store;
            return (
              <section
                key={s.id}
                className={`rounded-xl border bg-surface p-5 ${active ? "border-primary/60" : "border-border"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <Icon className="size-6 text-primary-hover" />
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs ${active ? "bg-primary/15 text-primary-hover" : "bg-surface-2 text-muted"}`}
                  >
                    {active
                      ? "Active location"
                      : s.locationType === "warehouse"
                        ? "Warehouse"
                        : "Store"}
                  </span>
                </div>
                <h2 className="mt-4 text-lg font-semibold">{s.name}</h2>
                <p className="text-xs text-muted">{s.businessName}</p>
                <dl className="my-5 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <dt className="text-xs text-muted">Products</dt>
                    <dd className="mt-1 font-medium">
                      {totals?.product_count ?? "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Staff</dt>
                    <dd className="mt-1 font-medium">{totals?.staff ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Stock value</dt>
                    <dd
                      className={`mt-1 inline-flex rounded-md border px-2 py-1 font-medium ${totals && totals.stock_value > 0 ? "border-success/30 bg-success/10 text-success" : "border-danger/30 bg-danger/10 text-danger"}`}
                    >
                      {totals ? money(totals.stock_value, s.currency) : "—"}
                    </dd>
                  </div>
                </dl>
                <Button asChild className="w-full">
                  <Link href={`/stores/${s.id}`}>
                    Open Store <ArrowRight className="size-4" />
                  </Link>
                </Button>
              </section>
            );
          })}
      </div>
    </div>
  );
}
