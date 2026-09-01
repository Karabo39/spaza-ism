"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { LoadingRows, EmptyState } from "@/components/ui/misc";
import { ToolbarSearch } from "@/components/shell/toolbar-search";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store-context";
import { qty, friendlyError } from "@/lib/format";
import { cn } from "@/lib/utils";

type Item = { id: string; product_id: string; system_qty: number; counted_qty: number | null; counted: boolean; variance: number | null; products: { name: string } | null };

export function StockTakeCounter({ stockTakeId, status, filter }: { stockTakeId: string; status: string; filter?: string }) {
  const router = useRouter();
  const { can } = useStore();
  const completed = status === "COMPLETED";
  const [busy, setBusy] = React.useState(false);
  const [local, setLocal] = React.useState<Record<string, string>>({});

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["stock-take-items", stockTakeId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("stock_take_items")
        .select("id, product_id, system_qty, counted_qty, counted, variance, products(name)")
        .eq("stock_take_id", stockTakeId)
        .order("product_id");
      if (error) throw error;
      return data as unknown as Item[];
    },
  });

  const items = (data ?? []).filter((i) =>
    !filter ? true : (i.products?.name ?? "").toLowerCase().includes(filter.toLowerCase()),
  );
  const countedCount = (data ?? []).filter((i) => i.counted).length;
  const total = (data ?? []).length;

  async function saveCount(item: Item, value: string) {
    const counted = value.trim() === "" ? null : Number(value);
    const supabase = createClient();
    const variance = counted === null ? null : counted - Number(item.system_qty);
    const { error } = await supabase.from("stock_take_items")
      .update({ counted_qty: counted, counted: counted !== null, variance })
      .eq("id", item.id);
    if (error) toast.error(friendlyError(error.message));
    else refetch();
  }

  async function complete() {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("complete_stock_take", { p_stock_take: stockTakeId });
    setBusy(false);
    if (error) { toast.error(friendlyError(error.message)); return; }
    toast.success("Stock take completed — variances applied to stock");
    router.refresh();
  }

  if (isLoading) return <div className="rounded-lg border border-border bg-surface"><LoadingRows cols={5} /></div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Badge variant={completed ? "success" : "warning"}>{completed ? "Completed" : "In progress"}</Badge>
          <span className="text-sm text-muted">{countedCount} of {total} counted</span>
        </div>
        <div className="flex items-center gap-2">
          <ToolbarSearch placeholder="Filter products…" />
          {!completed && can("manager") ? (
            <Button loading={busy} onClick={complete} disabled={countedCount === 0}>
              <ClipboardCheck className="size-4" /> Complete &amp; apply
            </Button>
          ) : null}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface">
        {items.length === 0 ? (
          <EmptyState icon={CheckCircle2} title="No products to count" />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Product</TH>
                <TH className="text-right">System qty</TH>
                <TH className="text-right w-40">Counted</TH>
                <TH className="text-right">Variance</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {items.map((i) => {
                const v = i.counted && i.counted_qty !== null ? Number(i.counted_qty) - Number(i.system_qty) : null;
                return (
                  <TR key={i.id}>
                    <TD className="font-medium">{i.products?.name ?? "—"}</TD>
                    <TD className="text-right tabular-nums text-muted-foreground">{qty(i.system_qty)}</TD>
                    <TD className="text-right">
                      {completed ? (
                        <span className="tabular-nums">{i.counted_qty !== null ? qty(i.counted_qty) : "—"}</span>
                      ) : (
                        <Input
                          type="number" step="0.001" min="0"
                          defaultValue={i.counted_qty ?? ""}
                          value={local[i.id] ?? (i.counted_qty ?? "")}
                          onChange={(e) => setLocal((s) => ({ ...s, [i.id]: e.target.value }))}
                          onBlur={(e) => saveCount(i, e.target.value)}
                          className="h-8 w-28 text-right ml-auto"
                          placeholder="count"
                        />
                      )}
                    </TD>
                    <TD className={cn("text-right tabular-nums", v && v > 0 ? "text-success" : v && v < 0 ? "text-danger" : "text-muted")}>
                      {v === null ? "—" : `${v > 0 ? "+" : ""}${qty(v)}`}
                    </TD>
                    <TD>{i.counted ? <Badge variant="success">Counted</Badge> : <Badge variant="neutral">Pending</Badge>}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </div>
    </div>
  );
}
