"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export function AuditDetails({
  id,
  businessId,
}: {
  id: string;
  businessId: string;
}) {
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: ["audit-detail", businessId, id],
    enabled: open,
    queryFn: async ({ signal }) => {
      const { data, error } = await createClient()
        .from("v_audit_activity")
        .select("entity_type,entity_id,stock_items,before_data,after_data")
        .eq("id", id)
        .eq("business_id", businessId)
        .abortSignal(signal)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("No longer available");
      return data;
    },
  });
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer text-accent">View details</summary>
      {open &&
        (query.isPending ? (
          <p role="status">Loading details…</p>
        ) : query.isError ? (
          <p role="alert">
            Could not load details.{" "}
            <button onClick={() => query.refetch()}>Retry</button>
          </p>
        ) : (
          <>
            <p className="mt-2 max-w-sm break-words">
              {query.data.stock_items || "No stock items"}
            </p>
            <p className="mt-2 max-w-xs break-all text-xs">
              {query.data.entity_type}: {query.data.entity_id}
            </p>
            <pre className="mt-2 max-h-64 max-w-sm overflow-auto whitespace-pre-wrap break-all text-xs">
              {JSON.stringify(
                {
                  before: query.data.before_data,
                  after: query.data.after_data,
                },
                null,
                2,
              )}
            </pre>
          </>
        ))}
    </details>
  );
}
