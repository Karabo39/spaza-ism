"use client";
import * as React from "react";
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
import { LocationProductPicker } from "./product-picker";
import { dateTime, friendlyError, qty } from "@/lib/format";
import type { ProductStock } from "@/lib/db/database.types";

export function UnpackConsole() {
  const { store, can } = useStore();
  const { online } = useOffline();
  const qc = useQueryClient();
  const [conversion, setConversion] = React.useState("");
  const [packs, setPacks] = React.useState(1);
  const [reason, setReason] = React.useState("");
  const [pack, setPack] = React.useState<ProductStock | null>(null);
  const [unit, setUnit] = React.useState<ProductStock | null>(null);
  const [ratio, setRatio] = React.useState(6);
  const [busy, setBusy] = React.useState(false);
  const request = React.useRef<string | null>(null);
  const [countOverride, setCountOverride] = React.useState(false),
    [counted, setCounted] = React.useState(1),
    [countExpiry, setCountExpiry] = React.useState("");
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
      return data;
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
  async function configure(e: React.FormEvent) {
    e.preventDefault();
    if (!pack || !unit || !online || busy) return;
    setBusy(true);
    try {
      const { data, error } = await createClient().rpc("set_bulk_conversion", {
        p_pack: pack.id,
        p_unit: unit.id,
        p_ratio: ratio,
      });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["bulk-conversions"] });
      setConversion(data!);
      toast.success("Pack conversion saved");
    } catch (e) {
      toast.error(friendlyError((e as Error).message));
    } finally {
      setBusy(false);
    }
  }
  async function unpack(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !online || busy || !Number.isInteger(packs) || packs <= 0)
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
      const { error } = countOverride
        ? await createClient().rpc("unpack_stock_with_count", {
            ...args,
            p_counted: counted,
            ...(countExpiry ? { p_expiry: countExpiry } : {}),
          })
        : await createClient().rpc("unpack_stock", args);
      if (error) throw error;
      toast.success(
        `${packs} pack(s) unpacked into ${packs * selected.units_per_pack} units`,
      );
      request.current = null;
      setPacks(1);
      setReason("");
      setCountOverride(false);
      setCountExpiry("");
      await qc.invalidateQueries({ queryKey: ["unpacking"] });
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
                  <option key={c.id} value={c.id}>
                    {c.pack_name} → {c.units_per_pack} × {c.unit_name}
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
            {can("manager") && selected ? (
              <div className="space-y-3 rounded-md border border-border p-3 md:col-span-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={countOverride}
                    onChange={(e) => {
                      setCountOverride(e.target.checked);
                      request.current = null;
                    }}
                  />
                  Manager override: correct a verified stock count before
                  unpacking
                </label>
                {countOverride ? (
                  <>
                    <p className="text-xs text-muted">
                      Use only when recorded bulk stock is insufficient but the
                      physical packs are available. Count all packs first. The
                      correction and unpacking are recorded together under your
                      name.
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="counted-packs">
                          Total physical packs counted
                        </Label>
                        <Input
                          id="counted-packs"
                          type="number"
                          min={packs}
                          step="1"
                          required
                          disabled={busy}
                          value={counted}
                          onChange={(e) => {
                            setCounted(Number(e.target.value));
                            request.current = null;
                          }}
                        />
                      </div>
                      <div>
                        <Label htmlFor="counted-expiry">
                          Expiry of newly counted packs (if tracked)
                        </Label>
                        <Input
                          id="counted-expiry"
                          type="date"
                          disabled={busy}
                          value={countExpiry}
                          onChange={(e) => {
                            setCountExpiry(e.target.value);
                            request.current = null;
                          }}
                        />
                      </div>
                    </div>
                    <p className="text-xs text-muted">
                      Explain the count discrepancy in Reason / reference. For
                      different expiry dates, receive the batches separately
                      before normal unpacking.
                    </p>
                  </>
                ) : null}
              </div>
            ) : null}
            {conversions.error ? (
              <p role="alert" className="text-danger">
                Could not load conversions.
              </p>
            ) : null}
            <Button
              type="submit"
              loading={busy}
              disabled={!online || !selected || !reason.trim()}
            >
              Confirm unpacking
            </Button>
          </form>
        </CardContent>
      </Card>
      {can("manager") ? (
        <Card>
          <CardHeader>
            <CardTitle>Configure pack conversion</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={configure} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <LocationProductPicker
                  location={store.id}
                  label="Bulk pack product"
                  value={pack}
                  onChange={setPack}
                />
                <LocationProductPicker
                  location={store.id}
                  label="Individual unit product"
                  value={unit}
                  onChange={setUnit}
                />
              </div>
              <div>
                <Label htmlFor="pack-ratio">Units in one pack</Label>
                <Input
                  id="pack-ratio"
                  type="number"
                  min="1"
                  max="100000"
                  step="1"
                  required
                  value={ratio}
                  onChange={(e) => setRatio(Number(e.target.value))}
                />
              </div>
              <p className="text-xs text-muted">
                Manager approval is required to configure conversions. Changing
                a ratio affects future unpacking only; past records retain their
                original ratio.
              </p>
              <Button
                type="submit"
                variant="secondary"
                disabled={
                  !online || busy || !pack || !unit || pack.id === unit.id
                }
              >
                Save conversion
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
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
