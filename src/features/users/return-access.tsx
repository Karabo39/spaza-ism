"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store-context";
import { useBillingAction } from "@/features/billing/use-billing-action";
import { Button } from "@/components/ui/button";
export function ReturnAccess({ membership }: { membership: string }) {
  const { store } = useStore();
  const query = useQuery({
    queryKey: ["billing", "return-grant", store.id, membership],
    queryFn: async () => {
      const { data, error } = await createClient()
        .from("store_return_access")
        .select("*")
        .eq("membership_id", membership)
        .eq("store_id", store.id)
        .maybeSingle();
      if (error) throw error;
      return data ?? { approve: false, refund: false, version: 0 };
    },
  });
  if (query.error)
    return (
      <p role="alert">
        Could not load return permissions.{" "}
        <Button onClick={() => query.refetch()}>Retry</Button>
      </p>
    );
  return query.data ? (
    <ReturnAccessEditor
      key={`${membership}:${store.id}:${query.data.version}`}
      membership={membership}
      initial={query.data}
    />
  ) : (
    <p>Loading return permissions...</p>
  );
}
function ReturnAccessEditor({
  membership,
  initial,
}: {
  membership: string;
  initial: { approve: boolean; refund: boolean; version: number };
}) {
  const { store } = useStore();
  const { online, busy, run } = useBillingAction();
  const [approve, setApprove] = useState(initial.approve);
  const [refund, setRefund] = useState(initial.refund);
  return (
    <fieldset className="m-5 space-y-3 rounded-lg border border-border p-4">
      <legend className="px-2 font-semibold">Delegated return actions</legend>
      <p className="text-sm text-muted-foreground">
        These actions apply only at {store.name} and require Goods Return module
        access. Managers and owners retain their existing approval powers.
      </p>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={approve}
          onChange={(e) => setApprove(e.target.checked)}
        />
        Approve or reject returns
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={refund}
          onChange={(e) => setRefund(e.target.checked)}
        />
        Record customer refunds
      </label>
      <Button
        loading={busy}
        disabled={
          !online || (approve === initial.approve && refund === initial.refund)
        }
        onClick={() =>
          run(
            () =>
              createClient().rpc("set_store_return_access", {
                p_membership: membership,
                p_store: store.id,
                p_approve: approve,
                p_refund: refund,
                p_expected: initial.version,
              }),
            "Return permissions saved",
          )
        }
      >
        Save return permissions
      </Button>
    </fieldset>
  );
}
