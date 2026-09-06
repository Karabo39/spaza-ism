"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store-context";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useBillingAction } from "./use-billing-action";
import { validReturnReasons } from "./return-reasons";

export function ReturnReasonSettings({ initial }: { initial: string[] }) {
  const { store, can } = useStore();
  const { online, busy, run } = useBillingAction();
  const [value, setValue] = useState(initial.join("\n"));
  const reasons = value
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const valid = validReturnReasons(reasons);
  if (!can("owner")) return null;
  return (
    <section className="mt-6 max-w-xl space-y-3 rounded-lg border border-border bg-surface p-5">
      <h2 className="font-semibold">Return reasons</h2>
      <p className="text-sm text-muted">
        Staff must choose one of these reasons when capturing a return. Previous
        returns keep their recorded reason. Choosing “Other” also requires an
        explanation.
      </p>
      <Label htmlFor="return-reasons">Allowed reasons, one per line</Label>
      <textarea
        id="return-reasons"
        rows={8}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-full rounded border border-border bg-input px-3 py-2"
      />
      <p className="text-xs text-muted">
        Use 1–20 distinct reasons, each up to 80 characters. Colons are reserved
        for the explanation.
      </p>
      {!valid && (
        <p role="alert" className="text-sm text-danger">
          Check the number, length and spelling of the reasons. Duplicate
          reasons and colons are not allowed.
        </p>
      )}
      <Button
        disabled={!online || !valid}
        loading={busy}
        onClick={() =>
          run(
            () =>
              createClient().rpc("set_return_reasons", {
                p_business: store.businessId,
                p_reasons: reasons,
              }),
            "Return reasons saved",
          )
        }
      >
        Save return reasons
      </Button>
    </section>
  );
}
