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
import { ExportButton } from "@/features/reports/export-button";
import { dateTime, friendlyError, qty } from "@/lib/format";
import type { ProductStock, TransferStatus } from "@/lib/db/database.types";

type Line = {
  source_product_id: string;
  destination_product_id: string;
  source_name: string;
  destination_name: string;
  quantity: number;
};
const ACTIONS: Partial<
  Record<TransferStatus, { action: string; label: string }>
> = {
  DRAFT: { action: "submit", label: "Submit" },
  SUBMITTED: { action: "dispatch", label: "Dispatch" },
  DISPATCHED: { action: "receive", label: "Receive & complete" },
};
export function TransfersConsole({
  receiving = false,
  historyOnly = false,
}: {
  receiving?: boolean;
  historyOnly?: boolean;
}) {
  const { store, stores, canModule } = useStore();
  const warehouse = store.locationType === "warehouse";
  const [editing, setEditing] = React.useState<{
    id: string;
    version: number;
  } | null>(null);
  const { online } = useOffline();
  const qc = useQueryClient();
  const [source, setSource] = React.useState(store.id);
  const [destination, setDestination] = React.useState("");
  const [src, setSrc] = React.useState<ProductStock | null>(null);
  const [dst, setDst] = React.useState<ProductStock | null>(null);
  const [quantity, setQuantity] = React.useState(1);
  const [lines, setLines] = React.useState<Line[]>([]);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState(receiving ? "DISPATCHED" : "all");
  const [filterSource, setFilterSource] = React.useState("");
  const [filterDestination, setFilterDestination] = React.useState("");
  const [filterProduct, setFilterProduct] = React.useState("");
  const [filterUser, setFilterUser] = React.useState("");
  const [fromDate, setFromDate] = React.useState("");
  const [toDate, setToDate] = React.useState("");
  const [cancelId, setCancelId] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("");
  const request = React.useRef<string | null>(null);
  const locations = stores.filter((s) => s.businessId === store.businessId);
  const { data, error, isLoading } = useQuery({
    queryKey: [
      "transfers",
      store.businessId,
      store.id,
      receiving,
      historyOnly,
      status,
      filterSource,
      filterDestination,
      filterProduct,
      filterUser,
      fromDate,
      toDate,
    ],
    enabled: online,
    queryFn: async () => {
      if (receiving) {
        const { data, error } = await createClient().rpc("warehouse_receipts", {
          p_store: store.id,
        });
        if (error) throw error;
        return data;
      }
      if (historyOnly) {
        const { data, error } = await createClient().rpc(
          "my_warehouse_transfers",
          { p_business: store.businessId },
        );
        if (error) throw error;
        return warehouse ? data?.filter((t) => t.source_id === store.id) : data;
      }
      const { data, error } = await createClient().rpc("transfer_history", {
        p_business: store.businessId,
        ...(receiving
          ? { p_status: "DISPATCHED" }
          : status !== "all"
            ? { p_status: status }
            : {}),
        ...(warehouse
          ? { p_source: store.id }
          : filterSource
            ? { p_source: filterSource }
            : {}),
        ...(receiving
          ? { p_destination: store.id }
          : filterDestination
            ? { p_destination: filterDestination }
            : {}),
        ...(filterProduct ? { p_product: filterProduct } : {}),
        ...(filterUser ? { p_user: filterUser } : {}),
        ...(fromDate ? { p_from: `${fromDate}T00:00:00+02:00` } : {}),
        ...(toDate
          ? {
              p_to: new Date(
                new Date(`${toDate}T00:00:00+02:00`).getTime() + 86400000,
              ).toISOString(),
            }
          : {}),
      });
      if (error) throw error;
      return warehouse
        ? data
        : data?.filter((t) =>
            locations.some(
              (s) => s.id === t.source_id && s.locationType === "store",
            ),
          );
    },
  });
  const operators = useQuery({
    queryKey: ["transfer-operators", store.businessId],
    enabled: online,
    queryFn: async () => {
      const { data, error } = await createClient()
        .from("profiles")
        .select("id,full_name")
        .order("full_name");
      if (error) throw error;
      return data;
    },
  });
  const match = useQuery({
    queryKey: ["warehouse-match", src?.id, destination],
    enabled: online && warehouse && !!src && !!destination,
    queryFn: async () => {
      const { data, error } = await createClient().rpc(
        "match_warehouse_product",
        { p_source: src!.id, p_destination: destination },
      );
      if (error) throw error;
      return data as ProductStock;
    },
  });
  const destinationProduct = warehouse ? match.data : dst;
  async function editDraft(id: string) {
    if (busy || !online) return;
    setBusy(true);
    try {
      const { data, error } = await createClient().rpc("transfer_detail", {
        p_transfer: id,
      });
      if (error) throw error;
      const d = data as {
        version: number;
        source_id: string;
        destination_id: string;
        note: string | null;
        items: Line[];
      };
      setSource(d.source_id);
      setDestination(d.destination_id);
      setLines(d.items);
      setNote(d.note || "");
      setEditing({ id, version: d.version });
      request.current = null;
      document
        .getElementById("transfer-editor")
        ?.scrollIntoView({ behavior: "smooth" });
    } catch (e) {
      toast.error(friendlyError((e as Error).message));
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    await qc.invalidateQueries({ queryKey: ["transfers"] });
    await qc.invalidateQueries({ queryKey: ["transfer-lines"] });
    await qc.invalidateQueries({ queryKey: ["operation-products"] });
    await qc.invalidateQueries({ queryKey: ["location-overview"] });
  }
  function addLine() {
    if (
      !src ||
      !destinationProduct ||
      !Number.isFinite(quantity) ||
      quantity <= 0
    )
      return;
    if (
      src.unit !== destinationProduct.unit ||
      src.track_expiry !== destinationProduct.track_expiry
    ) {
      toast.error(
        "Choose matching units and expiry tracking at both locations.",
      );
      return;
    }
    if (
      lines.some(
        (l) =>
          l.source_product_id === src.id &&
          l.destination_product_id === destinationProduct.id,
      )
    ) {
      toast.error("That product pair is already in the transfer.");
      return;
    }
    request.current = null;
    setLines([
      ...lines,
      {
        source_product_id: src.id,
        destination_product_id: destinationProduct.id,
        source_name: src.name,
        destination_name: destinationProduct.name,
        quantity,
      },
    ]);
    setSrc(null);
    setDst(null);
    setQuantity(1);
  }
  async function create() {
    if (!online || busy || !lines.length) return;
    setBusy(true);
    request.current ??= crypto.randomUUID();
    try {
      const payload = {
        p_source: source,
        p_destination: destination,
        p_note: note,
        p_request: request.current,
        p_items: lines.map(
          ({ source_product_id, destination_product_id, quantity }) => ({
            source_product_id,
            destination_product_id,
            quantity,
          }),
        ),
      };
      const { error } = warehouse
        ? await createClient().rpc("save_warehouse_transfer", {
            ...payload,
            ...(editing
              ? { p_transfer: editing.id, p_expected: editing.version }
              : {}),
          })
        : await createClient().rpc("create_stock_transfer", payload);
      if (error) throw error;
      setEditing(null);
      toast.success("Draft transfer saved. Submit when ready.");
      setLines([]);
      setNote("");
      request.current = null;
      await refresh();
    } catch (e) {
      toast.error(friendlyError((e as Error).message));
    } finally {
      setBusy(false);
    }
  }
  async function process(id: string, action: string) {
    if (!online || busy) return;
    setBusy(true);
    try {
      const { error } =
        action === "send"
          ? await createClient().rpc("submit_warehouse_transfer", {
              p_transfer: id,
            })
          : receiving && action === "receive"
            ? await createClient().rpc("receive_warehouse_transfer", {
                p_transfer: id,
                p_store: store.id,
              })
            : await createClient().rpc("process_stock_transfer", {
                p_transfer: id,
                p_action: action,
                ...(action === "cancel" ? { p_reason: reason } : {}),
              });
      if (error) throw error;
      toast.success("Transfer updated");
      setCancelId(null);
      setReason("");
      await refresh();
    } catch (e) {
      toast.error(friendlyError((e as Error).message));
    } finally {
      setBusy(false);
    }
  }
  const locationName = (id: string) =>
    locations.find((s) => s.id === id)?.name ?? "Location";
  const locationOptions = locations
    .filter((s) => warehouse || s.locationType !== "warehouse")
    .map((s) => (
      <option value={s.id} key={s.id}>
        {s.name} · {s.locationType}
      </option>
    ));
  return (
    <div className="space-y-6">
      {!online ? (
        <p
          role="status"
          className="rounded-md border border-border p-4 text-sm"
        >
          Transfers require a connection. Reconnect to create, dispatch or
          receive stock.
        </p>
      ) : null}
      {!receiving && !historyOnly && canModule("operations_transfer_create") ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {editing ? "Edit draft transfer" : "Create stock transfer"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4" id="transfer-editor">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="transfer-source">Source location</Label>
                <select
                  id="transfer-source"
                  className="h-10 w-full rounded-md border border-border bg-input px-2 text-sm"
                  value={source}
                  disabled={warehouse || busy || !!lines.length}
                  onChange={(e) => {
                    setSource(e.target.value);
                    setSrc(null);
                    request.current = null;
                  }}
                >
                  {locationOptions}
                </select>
              </div>
              <div>
                <Label htmlFor="transfer-destination">
                  Destination location
                </Label>
                <select
                  id="transfer-destination"
                  className="h-10 w-full rounded-md border border-border bg-input px-2 text-sm"
                  value={destination}
                  disabled={busy || !!lines.length || !!editing}
                  onChange={(e) => {
                    setDestination(e.target.value);
                    setDst(null);
                    request.current = null;
                  }}
                >
                  <option value="">Choose destination</option>
                  {locations
                    .filter(
                      (s) => s.id !== source && s.locationType === "store",
                    )
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
              </div>
              <LocationProductPicker
                key={`src-${source}`}
                location={source}
                label="Source product"
                value={src}
                onChange={setSrc}
              />
              {warehouse ? (
                <div>
                  <Label htmlFor="matched-destination">
                    Matching destination product
                  </Label>
                  <Input
                    id="matched-destination"
                    readOnly
                    value={
                      match.data?.name ||
                      (match.isFetching ? "Finding matching product…" : "")
                    }
                  />
                  <p className="text-xs text-muted">
                    Matched automatically by product link, SKU or barcode.
                  </p>
                  {match.error && (
                    <p role="alert" className="text-danger">
                      No unique matching product. Sync or correct the store
                      SKU/barcode before transferring.
                    </p>
                  )}
                </div>
              ) : (
                <LocationProductPicker
                  key={`dst-${destination}`}
                  location={destination}
                  label="Matching destination product"
                  value={dst}
                  onChange={setDst}
                />
              )}
            </div>
            <p className="text-xs text-muted">
              Warehouse destinations match automatically. If no unique match is
              found, correct the SKU or barcode in the store, then retry.
              Products must use matching units, expiry tracking and currency.
            </p>
            <div className="flex items-end gap-3">
              <div>
                <Label htmlFor="transfer-quantity">Quantity</Label>
                <Input
                  id="transfer-quantity"
                  type="number"
                  min="0.001"
                  step="1"
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                />
              </div>
              <Button
                variant="secondary"
                disabled={
                  !online ||
                  busy ||
                  !src ||
                  !destinationProduct ||
                  source === destination
                }
                onClick={addLine}
              >
                Add item
              </Button>
            </div>
            {lines.length ? (
              <Table>
                <THead>
                  <TR>
                    <TH>From product</TH>
                    <TH>To product</TH>
                    <TH>Quantity</TH>
                    <TH />
                  </TR>
                </THead>
                <TBody>
                  {lines.map((l, i) => (
                    <TR key={i}>
                      <TD>{l.source_name}</TD>
                      <TD>{l.destination_name}</TD>
                      <TD>{qty(l.quantity)}</TD>
                      <TD>
                        <Button
                          variant={
                            store.locationType === "warehouse"
                              ? "primary"
                              : "ghost"
                          }
                          size="sm"
                          disabled={busy}
                          onClick={() => {
                            setLines(lines.filter((_, index) => index !== i));
                            request.current = null;
                          }}
                        >
                          Remove
                        </Button>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : null}
            <div>
              <Label htmlFor="transfer-note">Reference or note</Label>
              <Input
                id="transfer-note"
                value={note}
                disabled={busy}
                onChange={(e) => {
                  setNote(e.target.value);
                  request.current = null;
                }}
              />
            </div>
            <Button
              onClick={create}
              disabled={!online || !lines.length || source === destination}
              loading={busy}
            >
              {editing ? "Save draft changes" : "Save draft transfer"}
            </Button>
            {editing && (
              <Button
                variant={
                  store.locationType === "warehouse" ? "primary" : "ghost"
                }
                onClick={() => {
                  setEditing(null);
                  setLines([]);
                  setNote("");
                  request.current = null;
                }}
              >
                Cancel editing
              </Button>
            )}
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <details open={!receiving && !historyOnly ? true : undefined}>
          <summary className="cursor-pointer p-5 font-semibold focus-ring">
            {receiving
              ? "Pending and received warehouse transfers"
              : historyOnly
                ? "My warehouse transfers"
                : "Transfer history"}
          </summary>
          <CardContent className="space-y-4">
            {!receiving && !historyOnly && (
              <div className="grid gap-3 md:grid-cols-3">
                <div>
                  <Label htmlFor="transfer-status">Status</Label>
                  <select
                    id="transfer-status"
                    className="h-10 w-full rounded-md border border-border bg-input px-2 text-sm"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                  >
                    <option value="all">All statuses</option>
                    {[
                      "DRAFT",
                      "SUBMITTED",
                      "DISPATCHED",
                      "RECEIVED",
                      "CANCELLED",
                    ].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="filter-source">From location</Label>
                  <select
                    id="filter-source"
                    className="h-10 w-full rounded-md border border-border bg-input px-2 text-sm"
                    value={filterSource}
                    onChange={(e) => setFilterSource(e.target.value)}
                  >
                    <option value="">All sources</option>
                    {locationOptions}
                  </select>
                </div>
                <div>
                  <Label htmlFor="filter-destination">To location</Label>
                  <select
                    id="filter-destination"
                    className="h-10 w-full rounded-md border border-border bg-input px-2 text-sm"
                    value={filterDestination}
                    onChange={(e) => setFilterDestination(e.target.value)}
                  >
                    <option value="">All destinations</option>
                    {locationOptions}
                  </select>
                </div>
              </div>
            )}
            {!receiving && !historyOnly && (
              <div className="grid gap-3 md:grid-cols-4">
                <div>
                  <Label htmlFor="transfer-product-filter">Product name</Label>
                  <Input
                    id="transfer-product-filter"
                    value={filterProduct}
                    onChange={(e) => setFilterProduct(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="transfer-operator">Operator</Label>
                  <select
                    id="transfer-operator"
                    className="h-10 w-full rounded-md border border-border bg-input px-2 text-sm"
                    value={filterUser}
                    onChange={(e) => setFilterUser(e.target.value)}
                  >
                    <option value="">All operators</option>
                    {operators.data?.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name || "Team member"}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="transfer-from-date">From date</Label>
                  <Input
                    id="transfer-from-date"
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="transfer-to-date">Through date</Label>
                  <Input
                    id="transfer-to-date"
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                  />
                </div>
              </div>
            )}
            {!receiving && !historyOnly && (
              <ExportButton
                filename="stock-transfers"
                rows={(data ?? []).map((t) => ({
                  ...t,
                  source: locationName(t.source_id),
                  destination: locationName(t.destination_id),
                }))}
                columns={[
                  { key: "reference", label: "Reference" },
                  { key: "source", label: "Source" },
                  { key: "destination", label: "Destination" },
                  { key: "status", label: "Status" },
                  { key: "created_at", label: "Created" },
                  { key: "dispatched_at", label: "Dispatched" },
                  { key: "received_at", label: "Received" },
                ]}
              />
            )}
            {error ? (
              <p role="alert" className="text-danger">
                {friendlyError(error.message)}
              </p>
            ) : isLoading ? (
              <p>Loading…</p>
            ) : (data ?? []).length === 0 ? (
              <p className="text-sm text-muted">No matching transfers.</p>
            ) : (
              (data ?? []).map((t) => (
                <div key={t.id} className="rounded-md border border-border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">
                        {locationName(t.source_id)} →{" "}
                        {locationName(t.destination_id)}
                      </p>
                      <p className="break-all text-xs text-muted">
                        {t.reference} · {dateTime(t.created_at)}
                      </p>
                      {t.status === "RECEIVED" ? (
                        <Button
                          size="sm"
                          disabled
                          className="mt-2 bg-success text-black disabled:opacity-100"
                        >
                          Received
                        </Button>
                      ) : (
                        <p
                          className={`mt-1 inline-flex rounded-md px-3 py-2 text-xs font-medium ${t.status === "DISPATCHED" || t.status === "CANCELLED" ? "bg-danger text-white" : "text-muted"}`}
                        >
                          {t.status === "DISPATCHED"
                            ? "Pending store receipt"
                            : t.status}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {warehouse &&
                        !historyOnly &&
                        t.status === "DRAFT" &&
                        canModule("operations_transfer_modify") &&
                        canModule("operations_transfer_create") && (
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() => void editDraft(t.id)}
                          >
                            Edit draft
                          </Button>
                        )}
                      {!historyOnly &&
                      (warehouse
                        ? canModule("operations_transfer_dispatch") &&
                          ["DRAFT", "SUBMITTED"].includes(t.status)
                        : ACTIONS[t.status]) &&
                      (t.status === "DISPATCHED"
                        ? (receiving ||
                            (!warehouse &&
                              store.id === t.destination_id &&
                              locations.some(
                                (s) =>
                                  s.id === t.source_id &&
                                  s.locationType === "store",
                              ))) &&
                          stores.find((s) => s.id === t.destination_id)?.modules
                            .goods_in_receive_transfer
                        : !receiving &&
                          stores.find((s) => s.id === t.source_id)?.modules[
                            t.status === "SUBMITTED"
                              ? "operations_transfer_dispatch"
                              : "operations_transfer_modify"
                          ]) ? (
                        <Button
                          size="sm"
                          disabled={!online || busy}
                          onClick={() =>
                            process(
                              t.id,
                              warehouse ? "send" : ACTIONS[t.status]!.action,
                            )
                          }
                        >
                          {warehouse
                            ? "Submit to Store"
                            : receiving
                              ? "Receive stock"
                              : ACTIONS[t.status]!.label}
                        </Button>
                      ) : null}
                      {!receiving &&
                      !historyOnly &&
                      stores.find((s) => s.id === t.source_id)?.modules
                        .operations_transfer_modify &&
                      !["RECEIVED", "CANCELLED"].includes(t.status) ? (
                        <Button
                          size="sm"
                          variant={
                            store.locationType === "warehouse"
                              ? "primary"
                              : "ghost"
                          }
                          disabled={!online || busy}
                          onClick={() => {
                            setCancelId(t.id);
                            setReason("");
                          }}
                        >
                          Cancel transfer
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  <TransferLines id={t.id} receiving={receiving} />
                  <p className="mt-2 text-xs text-muted">
                    Dispatched:{" "}
                    {t.dispatched_at ? dateTime(t.dispatched_at) : "Pending"} ·
                    Received:{" "}
                    {t.received_at ? dateTime(t.received_at) : "Pending"}
                  </p>
                  {t.cancellation_reason ? (
                    <p className="text-sm text-muted">
                      Cancelled: {t.cancellation_reason}
                    </p>
                  ) : null}
                  {cancelId === t.id ? (
                    <form
                      className="mt-3 flex flex-wrap gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void process(t.id, "cancel");
                      }}
                    >
                      <Input
                        aria-label="Cancellation reason"
                        placeholder="Reason for cancellation"
                        required
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                      />
                      <Button
                        type="submit"
                        variant="danger"
                        disabled={!reason.trim() || busy}
                      >
                        Confirm cancellation
                      </Button>
                      <Button
                        type="button"
                        variant={
                          store.locationType === "warehouse"
                            ? "primary"
                            : "ghost"
                        }
                        onClick={() => setCancelId(null)}
                      >
                        Keep transfer
                      </Button>
                    </form>
                  ) : null}
                </div>
              ))
            )}
            <p className="text-xs text-muted">
              Latest 200 matching transfers. Warehouse submission sends stock
              into transit. Store quantities and transfer prices update only on
              receipt.
            </p>
          </CardContent>
        </details>
      </Card>
    </div>
  );
}
function TransferLines({ id, receiving }: { id: string; receiving: boolean }) {
  const [open, setOpen] = React.useState(receiving);
  const { data, error } = useQuery({
    queryKey: ["transfer-lines", id],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await createClient().rpc("transfer_detail", {
        p_transfer: id,
      });
      if (error) throw error;
      return data as {
        source: string;
        destination: string;
        requested_by: string | null;
        dispatched_by: string | null;
        received_by: string | null;
        note: string | null;
        items: {
          id: string;
          source_name: string;
          destination_name: string;
          sku: string | null;
          quantity: number;
        }[];
      };
    },
  });
  return (
    <details
      open={open}
      className="mt-3 text-sm"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="cursor-pointer text-muted">
        Original transfer details
      </summary>
      {error ? (
        <p role="alert">Could not load items.</p>
      ) : data ? (
        <>
          <p>
            {data.source} → {data.destination}
          </p>
          <p className="text-xs text-muted">
            Requested by: {data.requested_by || "Not recorded"} · Dispatched by:{" "}
            {data.dispatched_by || "Pending"} · Received / completed by:{" "}
            {data.received_by || "Pending"}
          </p>
          {data.note && <p>{data.note}</p>}
          <ul className="mt-2 space-y-1">
            {data.items.map((i) => (
              <li key={i.id}>
                {qty(i.quantity)} × {i.source_name} → {i.destination_name}
                {i.sku ? ` · SKU: ${i.sku}` : ""}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p>Loading original transfer…</p>
      )}
    </details>
  );
}
