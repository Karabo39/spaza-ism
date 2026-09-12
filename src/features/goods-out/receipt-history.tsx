"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { dateTime, money } from "@/lib/format";
import type { SaleReceipt } from "./payments";
export function ReceiptHistory({ refreshKey }: { refreshKey: string | null }) {
  const { store, can } = useStore();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const db = createClient();
  const receipts = useQuery({
    queryKey: ["sale-receipts", store.id, refreshKey, search, page],
    queryFn: async () => {
      let q = db
        .from("sale_receipts")
        .select("sale_id,reference,snapshot,created_at")
        .eq("store_id", store.id)
        .order("created_at", { ascending: false })
        .order("sale_id")
        .range(page * 20, page * 20 + 19);
      if (search.trim())
        q = q.ilike(
          "reference",
          `%${search.trim().replace(/[^a-zA-Z0-9-]/g, "")}%`,
        );
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });
  const prefs = useQuery({
    queryKey: ["receipt-preferences", store.id],
    queryFn: async () => {
      const { data, error } = await db
        .from("receipt_preferences")
        .select("*")
        .eq("store_id", store.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  async function save(
    second: boolean,
    delay: number,
    paper = prefs.data?.paper_format ?? "80mm",
  ) {
    const { error } = await db.rpc("save_receipt_preferences", {
      p_store: store.id,
      p_second: second,
      p_delay: delay,
      p_paper: paper,
    });
    if (error) toast.error("Could not save receipt settings.");
    else {
      await prefs.refetch();
      toast.success("Receipt settings saved.");
    }
  }
  return (
    <section className="space-y-3 rounded-lg border border-border p-4">
      <h2 className="font-semibold">Saved receipts</h2>
      <p className="text-xs text-muted">
        Search a receipt number to view, print, save PDF or email the original.
        Offline sales appear after successful sync.
      </p>
      <Input
        aria-label="Search receipt number"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(0);
        }}
        placeholder="POS-…"
      />
      {receipts.isError ? (
        <p role="alert">
          Could not load receipts.{" "}
          <button onClick={() => receipts.refetch()}>Retry</button>
        </p>
      ) : receipts.isPending ? (
        <p>Loading receipts…</p>
      ) : (
        <ul className="divide-y divide-border">
          {receipts.data?.map((row) => {
            const receipt = row.snapshot as SaleReceipt;
            return (
              <li
                key={row.sale_id}
                className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
              >
                <div>
                  <Link
                    className="break-all text-accent"
                    href={`/goods-out/${row.sale_id}/receipt`}
                  >
                    {row.reference}
                  </Link>
                  <p className="text-xs text-muted">
                    {dateTime(row.created_at)} · {receipt.cashier} ·{" "}
                    {receipt.status}
                  </p>
                </div>
                <span>{money(receipt.total, receipt.currency)}</span>
              </li>
            );
          })}
          {receipts.data?.length === 0 && <li>No receipts found.</li>}
        </ul>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={page === 0}
          onClick={() => setPage(page - 1)}
        >
          Previous
        </Button>
        <Button
          size="sm"
          disabled={receipts.data?.length !== 20}
          onClick={() => setPage(page + 1)}
        >
          Next
        </Button>
      </div>
      {can("manager") && !prefs.isPending && !prefs.isError && (
        <details>
          <summary className="cursor-pointer text-sm">
            Store receipt settings
          </summary>
          <div className="mt-3 space-y-2 text-sm">
            <label className="flex gap-2">
              <input
                type="checkbox"
                checked={prefs.data?.second_copy ?? false}
                onChange={(e) =>
                  save(e.target.checked, prefs.data?.delay_seconds ?? 3)
                }
              />
              Request a second receipt copy automatically
            </label>
            <label>
              Delay after the first print dialog closes{" "}
              <select
                value={prefs.data?.delay_seconds ?? 3}
                onChange={(e) =>
                  save(prefs.data?.second_copy ?? false, Number(e.target.value))
                }
              >
                {[2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n} seconds
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              Receipt paper{" "}
              <select
                value={prefs.data?.paper_format ?? "80mm"}
                onChange={(e) =>
                  save(
                    prefs.data?.second_copy ?? false,
                    prefs.data?.delay_seconds ?? 3,
                    e.target.value,
                  )
                }
              >
                <option value="58mm">58 mm thermal</option>
                <option value="80mm">80 mm thermal</option>
                <option value="A4">A4</option>
              </select>
            </label>
            <p className="text-xs text-muted">
              Choose the installed USB, network or Bluetooth printer in the
              system print dialog. Browser printing requires confirmation for
              each copy. A print request does not confirm paper was printed.
            </p>
          </div>
        </details>
      )}
    </section>
  );
}
