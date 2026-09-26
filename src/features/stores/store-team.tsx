"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useStore } from "@/lib/store-context";
import { useOffline } from "@/lib/offline/offline-context";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { friendlyError } from "@/lib/format";
export function StoreTeam() {
  const { store } = useStore();
  const { online } = useOffline();
  const cache = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const query = useQuery({
    queryKey: ["store-team", store.id],
    enabled: online,
    queryFn: async () => {
      const db = createClient();
      const [{ data: members }, { data: assigned }] = await Promise.all([
        db
          .from("memberships")
          .select("id,user_id,role")
          .eq("business_id", store.businessId)
          .eq("is_active", true)
          .throwOnError(),
        db
          .from("store_memberships")
          .select("membership_id")
          .eq("store_id", store.id)
          .throwOnError(),
      ]);
      const { data: profiles } = await db
        .from("profiles")
        .select("id,full_name")
        .in(
          "id",
          (members ?? []).map((m) => m.user_id),
        )
        .throwOnError();
      return (members ?? []).map((m) => ({
        ...m,
        name:
          profiles?.find((p) => p.id === m.user_id)?.full_name ?? "Team member",
        assigned:
          m.role === "owner" ||
          !!assigned?.some((a) => a.membership_id === m.id),
      }));
    },
  });
  async function assign(id: string, assigned: boolean) {
    setBusy(true);
    setError("");
    try {
      const { error } = await createClient().rpc("set_store_member_access", {
        p_store: store.id,
        p_membership: id,
        p_assigned: assigned,
      });
      if (error) throw error;
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["store-team", store.id] }),
        cache.invalidateQueries({ queryKey: ["store-setup"] }),
      ]);
    } catch (e) {
      setError(friendlyError((e as Error).message));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3">
      <p className="text-sm text-muted">
        Assign staff to {store.name}. Module permissions are managed in Access
        Control. Other store assignments stay unchanged.
      </p>
      {(error || query.error) && (
        <p role="alert" className="text-danger">
          {error || friendlyError(query.error!.message)}
        </p>
      )}
      {!online && <p role="status">Connect to manage this store’s team.</p>}
      {query.isLoading && <p>Loading team…</p>}
      {query.data?.map((m) => (
        <div
          key={m.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
        >
          <div>
            <p>{m.name}</p>
            <p className="text-xs text-muted">
              {m.role} · {m.assigned ? "Has store access" : "Not assigned"}
            </p>
          </div>
          {m.role === "owner" ? (
            <span className="text-sm">All stores</span>
          ) : (
            <Button
              size="sm"
              variant={m.assigned ? "outline" : "primary"}
              disabled={busy || !online}
              onClick={() => void assign(m.id, !m.assigned)}
            >
              {m.assigned ? "Remove from this store" : "Assign to this store"}
            </Button>
          )}
        </div>
      ))}
    </section>
  );
}
