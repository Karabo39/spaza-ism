"use client";
import * as React from "react";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useStore } from "@/lib/store-context";
import { useOffline } from "@/lib/offline/offline-context";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { dateTime, friendlyError, qty } from "@/lib/format";

export function UnpackConsole() {
  const { store } = useStore();
  const { online } = useOffline();
  const qc = useQueryClient();
  const [conversion, setConversion] = React.useState("");
  const [packs, setPacks] = React.useState(1);
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const request = React.useRef<string | null>(null);
  const conversions = useQuery({
    queryKey: ["bulk-conversions", store.id],
    enabled: online,
    queryFn: async () => {
      const { data, error } = await createClient()
        .from("bulk_conversions")
        .select("*")
        .eq("store_id", store.id)
        .order("pack_name");
      if (error) throw error;
      if (data?.length) {
        const { data: stock, error: stockError } = await createClient()
          .from("stock")
          .select("product_id,quantity")
          .eq("store_id", store.id)
          .in(
            "product_id",
            data.map((c) => c.pack_product_id),
          )
          .gt("quantity", 0);
        if (stockError) throw stockError;
        return data.map((c) => ({
          ...c,
          available: Number(
            stock?.find((s) => s.product_id === c.pack_product_id)?.quantity ??
              0,
          ),
        }));
      }
      return (data ?? []).map((c) => ({ ...c, available: 0 }));
    },
  });
  const history = useQuery({
    queryKey: ["unpacking", store.id],
    enabled: online,
    queryFn: async () => {
      const { data, error } = await createClient()
        .from("bulk_unpackings")
        .select("*")
        .eq("store_id", store.id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });
  const selected = conversions.data?.find((c) => c.id === conversion);
  async function unpack(e: React.FormEvent) {
    e.preventDefault();
    if (
      !selected ||
      !online ||
      busy ||
      !Number.isInteger(packs) ||
      packs <= 0 ||
      packs > selected.available
    )
      return;
    setBusy(true);
    request.current ??= crypto.randomUUID();
    try {
      const args = {
        p_conversion: conversion,
        p_packs: packs,
        p_reason: reason,
        p_request: request.current,
      };
      const { error } = await createClient().rpc("unpack_stock", args);
      if (error) throw error;
      toast.success(
        `${packs} pack(s) unpacked into ${packs * selected.units_per_pack} units`,
      );
      request.current = null;
      setPacks(1);
      setReason("");
      await qc.invalidateQueries({ queryKey: ["unpacking"] });
      await qc.invalidateQueries({ queryKey: ["bulk-conversions"] });
      await qc.invalidateQueries({ queryKey: ["operation-products"] });
      await qc.invalidateQueries({ queryKey: ["location-overview"] });
    } catch (e) {
      toast.error(friendlyError((e as Error).message));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">
        Location: {store.name}. Unpacked units stay at this location. This
        operation requires a connection.
      </p>
      <CollapsibleSection title="View available Bulk Stock" defaultOpen={false}>
        {conversions.error ? (
          <p role="alert">Could not load bulk stock.</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Bulk Stock</TH>
                <TH>Available packs</TH>
                <TH>Individual item</TH>
                <TH>Units per pack</TH>
              </TR>
            </THead>
            <TBody>
              {conversions.data
                ?.filter((c) => c.available > 0)
                .map((c) => (
                  <TR key={c.id}>
                    <TD>{c.pack_name}</TD>
                    <TD>{qty(c.available)}</TD>
                    <TD>{c.unit_name}</TD>
                    <TD>{c.units_per_pack}</TD>
                  </TR>
                ))}
            </TBody>
          </Table>
        )}
        {!conversions.isPending &&
          !conversions.error &&
          !conversions.data?.some((c) => c.available > 0) && (
            <p>
              No bulk stock available at {store.name}. Receive packs here first.
            </p>
          )}
      </CollapsibleSection>
      <Card>
        <CardHeader>
          <CardTitle>Unpack bulk stock</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={unpack} className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="conversion">Configured pack</Label>
              <select
                id="conversion"
                className="h-10 w-full rounded-md border border-border bg-input px-2 text-sm"
                disabled={!online || busy}
                value={conversion}
                onChange={(e) => {
                  setConversion(e.target.value);
                  request.current = null;
                }}
              >
                <option value="">Choose a pack</option>
                {conversions.data?.map((c) => (
                  <option key={c.id} value={c.id} disabled={c.available <= 0}>
                    {c.pack_name} → {c.units_per_pack} × {c.unit_name} ·{" "}
                    {qty(c.available)} packs available
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="unpack-packs">Number of packs</Label>
              <Input
                id="unpack-packs"
                required
                type="number"
                min="1"
                max={selected?.available ?? 0}
                step="1"
                disabled={busy}
                value={packs}
                onChange={(e) => {
                  setPacks(Number(e.target.value));
                  request.current = null;
                }}
              />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="unpack-reason">Reason / reference</Label>
              <Input
                id="unpack-reason"
                required
                value={reason}
                disabled={busy}
                onChange={(e) => {
                  setReason(e.target.value);
                  request.current = null;
                }}
                placeholder="e.g. Refill shelf"
              />
            </div>
            {selected ? (
              <p className="text-sm md:col-span-2">
                Remove {packs} × {selected.pack_name}; add{" "}
                {qty(packs * selected.units_per_pack)} × {selected.unit_name}.
                Insufficient bulk stock is blocked.
              </p>
            ) : null}
            {conversions.error ? (
              <p role="alert" className="text-danger">
                Could not load conversions.
              </p>
            ) : null}
            <Button
              type="submit"
              loading={busy}
              disabled={
                !online ||
                !selected ||
                !reason.trim() ||
                packs > (selected?.available ?? 0) ||
                packs < 1 ||
                !Number.isInteger(packs)
              }
            >
              Confirm unpacking
            </Button>
          </form>
        </CardContent>
      </Card>
      <p className="text-sm text-muted">
        Configure Bulk Stock and units per pack in the main product’s settings.
        Unpacking always adds units to that linked product.
      </p>
      <Card>
        <CardHeader>
          <CardTitle>Unpacking history</CardTitle>
        </CardHeader>
        <CardContent>
          {history.error ? (
            <p role="alert" className="text-danger">
              Could not load unpacking history.
            </p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Date</TH>
                  <TH>Pack</TH>
                  <TH>Units produced</TH>
                  <TH>Reason</TH>
                </TR>
              </THead>
              <TBody>
                {history.data?.map((u) => (
                  <TR key={u.id}>
                    <TD>
                      {dateTime(u.created_at)}
                      <p className="break-all text-xs text-muted">
                        {u.reference}
                      </p>
                    </TD>
                    <TD>
                      {u.packs} × {u.pack_name}
                    </TD>
                    <TD>
                      {qty(u.units)} × {u.unit_name}
                    </TD>
                    <TD>{u.reason}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
          <p className="mt-3 text-xs text-muted">
            Latest 200 unpacking records for {store.name}.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
