"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { LoadingRows } from "@/components/ui/misc";
import { ToolbarSearch } from "@/components/shell/toolbar-search";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store-context";
import { useOffline } from "@/lib/offline/offline-context";
import { ExportButton } from "@/features/reports/export-button";
import { qty, friendlyError } from "@/lib/format";
type Item = {
  id: string;
  product_id: string;
  system_qty: number;
  counted_qty: number | null;
  counted: boolean;
  variance: number | null;
  counted_expiry: string | null;
  products: { name: string; track_expiry: boolean } | null;
};
export function StockTakeCounter({
  stockTakeId,
  status,
  filter,
}: {
  stockTakeId: string;
  status: string;
  filter?: string;
}) {
  const router = useRouter(),
    cache = useQueryClient(),
    { can } = useStore(),
    { online } = useOffline();
  const closed = status !== "IN_PROGRESS";
  const [busy, setBusy] = useState(false),
    [saving, setSaving] = useState(0),
    [local, setLocal] = useState<Record<string, string>>({}),
    [expiry, setExpiry] = useState<Record<string, string>>({}),
    [reason, setReason] = useState("");
  const pending = useRef(0);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["stock-take-items", stockTakeId],
    enabled: online,
    queryFn: async () => {
      const { data, error } = await createClient()
        .from("stock_take_items")
        .select(
          "id,product_id,system_qty,counted_qty,counted,variance,counted_expiry,products(name,track_expiry)",
        )
        .eq("stock_take_id", stockTakeId)
        .order("product_id");
      if (error) throw error;
      return data as unknown as Item[];
    },
  });
  const items = (data ?? []).filter(
    (i) =>
      !filter ||
      (i.products?.name ?? "").toLowerCase().includes(filter.toLowerCase()),
  );
  const counted = (data ?? []).filter((i) => i.counted).length;
  async function save(item: Item) {
    const value = local[item.id] ?? String(item.counted_qty ?? ""),
      n = value.trim() === "" ? null : Number(value),
      date = expiry[item.id] ?? item.counted_expiry ?? "";
    if (n !== null && (!Number.isFinite(n) || n < 0)) {
      toast.error("Enter a non-negative count.");
      return;
    }
    pending.current++;
    setSaving(pending.current);
    try {
      const { error } = await createClient().rpc("save_stock_take_count", {
        p_item: item.id,
        p_quantity: n,
        ...(date ? { p_expiry: date } : {}),
      });
      if (error) throw error;
      await refetch();
      setLocal((old) => {
        const next = { ...old };
        delete next[item.id];
        return next;
      });
      toast.success("Count saved.");
    } catch (error) {
      toast.error(friendlyError((error as Error).message));
    } finally {
      pending.current--;
      setSaving(pending.current);
    }
  }
  async function finish(cancel = false) {
    if (!online || busy || pending.current) return;
    if (!cancel && Object.keys(local).length) {
      toast.error("Save each edited count before approving the stock take.");
      return;
    }
    setBusy(true);
    try {
      const db = createClient();
      const { error } = cancel
        ? await db.rpc("cancel_stock_take", {
            p_stock_take: stockTakeId,
            p_reason: reason,
          })
        : await db.rpc("complete_stock_take", { p_stock_take: stockTakeId });
      if (error) throw error;
      toast.success(cancel ? "Stock take cancelled." : "Stock take completed.");
      router.refresh();
      await cache.invalidateQueries();
    } catch (error) {
      toast.error(friendlyError((error as Error).message));
    } finally {
      setBusy(false);
    }
  }
  if (isLoading) return <LoadingRows cols={6} />;
  const exportRows = items.map((i) => ({
    name: i.products?.name,
    system: Number(i.system_qty),
    counted: i.counted_qty === null ? "" : Number(i.counted_qty),
    variance: i.variance === null ? "" : Number(i.variance),
    status: i.counted ? "Counted" : "Pending",
    expiry: i.counted_expiry ?? "",
  }));
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Count and save one product at a time. Pause movements while counting.
        Stock changes after a saved count require a fresh count before approval.
        Added tracked stock needs an expiry date.
      </p>
      {!online && (
        <p className="text-warning">
          Connect to count stock and approve changes.
        </p>
      )}
      {error && (
        <p role="alert" className="text-danger">
          Could not load this stock take.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Badge variant={status === "COMPLETED" ? "success" : "neutral"}>
            {status.replaceAll("_", " ")}
          </Badge>
          <span className="text-sm">
            {counted} of {data?.length ?? 0} counted
          </span>
        </div>
        <ToolbarSearch placeholder="Filter products…" />
        <ExportButton
          filename="stock-take-variance"
          rows={exportRows}
          columns={[
            { key: "name", label: "Product" },
            { key: "system", label: "System at count" },
            { key: "counted", label: "Physical count" },
            { key: "variance", label: "Variance" },
            { key: "status", label: "Count status" },
            { key: "expiry", label: "Added stock expiry" },
          ]}
        />
      </div>
      <div className="rounded-lg border border-border bg-surface">
        <Table>
          <THead>
            <TR>
              <TH>Product</TH>
              <TH>System at count</TH>
              <TH>Physical count</TH>
              <TH>Added stock expiry</TH>
              <TH>Variance</TH>
              <TH>Save / status</TH>
            </TR>
          </THead>
          <TBody>
            {items.map((item) => (
              <TR key={item.id}>
                <TD>{item.products?.name ?? "—"}</TD>
                <TD>{qty(item.system_qty)}</TD>
                <TD>
                  {closed ? (
                    item.counted_qty === null ? (
                      "—"
                    ) : (
                      qty(item.counted_qty)
                    )
                  ) : (
                    <Input
                      aria-label={`Count ${item.products?.name}`}
                      className="w-28"
                      type="number"
                      min="0"
                      step="0.001"
                      disabled={busy || saving > 0 || !online}
                      value={local[item.id] ?? item.counted_qty ?? ""}
                      onChange={(e) =>
                        setLocal((old) => ({
                          ...old,
                          [item.id]: e.target.value,
                        }))
                      }
                    />
                  )}
                </TD>
                <TD>
                  {!closed && item.products?.track_expiry ? (
                    <Input
                      aria-label={`Expiry ${item.products.name}`}
                      type="date"
                      className="w-40"
                      disabled={busy || saving > 0 || !online}
                      value={expiry[item.id] ?? item.counted_expiry ?? ""}
                      onChange={(e) => {
                        setExpiry((old) => ({
                          ...old,
                          [item.id]: e.target.value,
                        }));
                        setLocal((old) => ({
                          ...old,
                          [item.id]:
                            old[item.id] ?? String(item.counted_qty ?? ""),
                        }));
                      }}
                    />
                  ) : (
                    (item.counted_expiry ?? "—")
                  )}
                </TD>
                <TD>{item.variance === null ? "—" : qty(item.variance)}</TD>
                <TD>
                  {closed ? (
                    <span>{item.counted ? "Counted" : "Pending"}</span>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy || saving > 0 || !online}
                      onClick={() => save(item)}
                    >
                      Save count
                    </Button>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
      {!closed && (
        <div className="flex flex-wrap items-center gap-3">
          {can("manager") && (
            <Button
              loading={busy}
              disabled={!online || saving > 0 || !counted}
              onClick={() => finish()}
            >
              Approve &amp; apply counts
            </Button>
          )}
          <Input
            className="max-w-sm"
            aria-label="Stock take cancellation reason"
            placeholder="Reason to abandon this count"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <Button
            variant="secondary"
            disabled={!online || busy || saving > 0 || !reason.trim()}
            onClick={() => finish(true)}
          >
            Cancel stock take
          </Button>
        </div>
      )}
    </div>
  );
}
