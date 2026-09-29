"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useBillingAction } from "@/features/billing/use-billing-action";
import { statusLabel } from "@/features/billing/status-label";
import { dateOnly, dateTime } from "@/lib/format";
import type { Json } from "@/lib/db/database.types";
import {
  CANCELLATION_REASONS,
  DELIVERY_TERMINAL,
  type DeliveryDetail,
} from "./types";
import { DeliveryHistory } from "./delivery-history";
export function DeliveryPanel({
  orderId,
  compact = false,
}: {
  orderId: string;
  compact?: boolean;
}) {
  const { canModule } = useStore();
  const query = useQuery({
    queryKey: ["billing", "delivery-detail", orderId],
    enabled: canModule("orders_deliveries"),
    queryFn: async () => {
      const { data, error } = await createClient().rpc("delivery_detail", {
        p_order: orderId,
      });
      if (error) throw error;
      return data as unknown as DeliveryDetail;
    },
  });
  if (!canModule("orders_deliveries")) return null;
  if (query.error)
    return (
      <p role="alert">
        Could not load delivery details.{" "}
        <Button onClick={() => query.refetch()}>Retry</Button>
      </p>
    );
  if (!query.data) return <p role="status">Loading delivery details…</p>;
  if (compact)
    return (
      <div className="rounded border border-border p-3">
        <p>
          Delivery:{" "}
          {query.data.delivery
            ? statusLabel(query.data.delivery.status)
            : query.data.order.required
              ? "Required — awaiting full payment"
              : "Collection / not required"}
        </p>
        <Button asChild>
          <Link href={`/orders/deliveries/${orderId}`}>Manage delivery</Link>
        </Button>
      </div>
    );
  return (
    <DeliveryEditor
      key={`${orderId}:${query.data.order.version}:${query.data.delivery?.version}`}
      data={query.data}
    />
  );
}
function DeliveryEditor({ data }: { data: DeliveryDetail }) {
  const { can, canModule } = useStore(),
    action = useBillingAction(),
    d = data.delivery;
  const [required, setRequired] = useState(data.order.required),
    [date, setDate] = useState(
      d?.scheduled_date ||
        data.order.details.date ||
        new Intl.DateTimeFormat("en-CA", { timeZone: data.timezone }).format(
          new Date(),
        ),
    );
  const [address, setAddress] = useState(
      d?.snapshot.delivery_address ||
        data.order.details.address ||
        data.customer.address ||
        "",
    ),
    [phone, setPhone] = useState(
      d?.snapshot.contact_number ||
        data.order.details.phone ||
        data.customer.phone ||
        "",
    );
  const [notes, setNotes] = useState(
      d?.comments || data.order.details.notes || "",
    ),
    [driver, setDriver] = useState(d?.driver_name || ""),
    [vehicle, setVehicle] = useState(d?.vehicle_registration || ""),
    [reference, setReference] = useState(d?.delivery_reference || "");
  const [remarks, setRemarks] = useState<Record<string, string>>(
    Object.fromEntries(d?.snapshot.items.map((i) => [i.id, i.remarks]) ?? []),
  );
  const [operation, setOperation] = useState(""),
    [reason, setReason] = useState(""),
    [receivedBy, setReceivedBy] = useState(""),
    [receiverPhone, setReceiverPhone] = useState(""),
    [actionNotes, setActionNotes] = useState("");
  const closed = !!d && DELIVERY_TERMINAL.includes(d.status);
  const editAllowed =
    !!d && ["PENDING", "FAILED", "RESCHEDULED"].includes(d.status);
  function send(operation: string, details: Record<string, Json>) {
    if (!d) return;
    const payload = {
      p_id: d.id,
      p_expected: d.version,
      p_action: operation,
      p_details: details,
    };
    void action.run(
      () =>
        createClient().rpc("process_delivery", {
          ...payload,
          p_request: action.request(payload),
        }),
      "Delivery updated",
      () => setOperation(""),
    );
  }
  const labels: Record<string, string> = {
    dispatch: "Mark out for delivery",
    complete: "Confirm delivered / completed",
    fail: "Record failed attempt",
    reschedule: "Reschedule delivery",
    cancel: "Cancel delivery",
    cancel_order: "Cancel order and delivery",
  };
  return (
    <section className="space-y-6">
      <div className="rounded-lg border border-border bg-surface p-5 space-y-3">
        <h2 className="font-semibold">Order {data.order.reference}</h2>
        <p>
          {data.customer.name} · Payment:{" "}
          {data.payment_status
            ? statusLabel(data.payment_status)
            : "Not invoiced"}
        </p>
        <p>
          Delivery:{" "}
          <strong>
            {d
              ? statusLabel(d.status)
              : data.order.required
                ? "Awaiting full payment"
                : "Not required"}
          </strong>
        </p>
        {d && (
          <>
            <p className="break-all">Delivery note: {d.reference}</p>
            <p>
              Original date: {dateOnly(d.original_date)} · Scheduled:{" "}
              {dateOnly(d.scheduled_date)} ({data.timezone})
            </p>
            <Button asChild>
              <Link href={`/orders/deliveries/${data.order.id}/note`}>
                Print delivery note
              </Link>
            </Button>
          </>
        )}
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="secondary">
            <Link href={`/orders?order=${data.order.id}`}>View order</Link>
          </Button>
          {data.invoice_id && canModule("invoices_view_invoices") && (
            <Button asChild variant="secondary">
              <Link href={`/invoices/${data.invoice_id}`}>
                View invoice / release goods
              </Link>
            </Button>
          )}
        </div>
        {d?.status === "DELIVERED" && (
          <p>
            Delivered {dateTime(d.delivered_at!)} · Received by {d.received_by}
            {d.receiver_phone && ` · ${d.receiver_phone}`}. Confirmed{" "}
            {dateTime(d.confirmed_at!)}; confirming user is recorded in the
            activity history.
          </p>
        )}
        {d?.status === "CANCELLED" && (
          <p>
            Cancelled {dateTime(d.cancelled_at!)} · {d.cancellation_reason}.{" "}
            {d.comments} Cancelling does not refund payment or restore stock;
            use the existing returns/refund process where needed.
          </p>
        )}
      </div>
      {!d && data.order.status !== "CANCELLED" && (
        <form
          className="rounded-lg border border-border p-5 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(
              () =>
                createClient().rpc("configure_order_delivery", {
                  p_order: data.order.id,
                  p_expected: data.order.version,
                  p_required: required,
                  p_details: { date, address, phone, notes },
                }),
              "Delivery requirement saved",
            );
          }}
        >
          <fieldset
            disabled={action.busy || !action.online}
            className="space-y-3"
          >
            <label className="flex gap-2">
              <input
                type="checkbox"
                checked={required}
                onChange={(e) => setRequired(e.target.checked)}
              />
              Delivery required
            </label>
            {required && (
              <>
                <label className="block">
                  Expected delivery date
                  <Input
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </label>
                <label className="block">
                  Delivery address
                  <Input
                    required
                    maxLength={1000}
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                  />
                </label>
                <label className="block">
                  Customer contact number
                  <Input
                    required
                    maxLength={80}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </label>
                <label className="block">
                  Delivery instructions
                  <Input
                    maxLength={2000}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </label>
              </>
            )}
            <p className="text-sm text-muted">
              The delivery note is generated automatically when the invoice is
              fully paid. Dispatch requires goods to be released through the
              invoice first.
            </p>
            <Button type="submit">Save delivery requirement</Button>
          </fieldset>
        </form>
      )}
      {d && editAllowed && (
        <form
          className="rounded-lg border border-border p-5 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            send("update", {
              address,
              phone,
              driver_name: driver,
              vehicle_registration: vehicle,
              delivery_reference: reference,
              notes,
              remarks,
            });
          }}
        >
          <h3 className="font-semibold">Driver and delivery details</h3>
          <fieldset
            disabled={action.busy || !action.online}
            className="space-y-3"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <label>
                  Driver name (optional)
                <Input
                  maxLength={150}
                  value={driver}
                  onChange={(e) => setDriver(e.target.value)}
                />
              </label>
              <label>
                  Vehicle registration (optional)
                <Input
                  maxLength={50}
                  value={vehicle}
                  onChange={(e) => setVehicle(e.target.value)}
                />
              </label>
              <label>
                Delivery reference
                <Input
                  maxLength={150}
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </label>
              <label>
                Contact number
                <Input
                  required
                  maxLength={80}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </label>
              <label className="sm:col-span-2">
                Delivery address
                <Input
                  required
                  maxLength={1000}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </label>
            </div>
            <label className="block">
              Delivery instructions
              <Input
                maxLength={2000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
            {d.snapshot.items.map((i) => (
              <label key={i.id} className="block">
                {i.description} — {i.delivery_quantity} {i.unit}
                <Input
                  aria-label={`Remarks for ${i.description}`}
                  placeholder="Item remarks (optional)"
                  maxLength={500}
                  value={remarks[i.id] ?? ""}
                  onChange={(e) =>
                    setRemarks({ ...remarks, [i.id]: e.target.value })
                  }
                />
              </label>
            ))}
            <Button type="submit">Save driver and delivery details</Button>
          </fieldset>
        </form>
      )}
      {d && !closed && (
        <section className="rounded-lg border border-border p-5 space-y-3">
          <h3 className="font-semibold">Update delivery</h3>
          <p className="text-sm">
            Driver and vehicle details are optional. Completing delivery confirms
            receipt of all items on the note.
          </p>
          {!data.goods_issued_at && (
            <p className="text-warning">
              Goods have not been released. Release them on the invoice before
              dispatch.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {(d.status === "OUT_FOR_DELIVERY"
              ? [
                  "complete",
                  "fail",
                  "reschedule",
                  "cancel",
                  ...(can("manager") ? ["cancel_order"] : []),
                ]
              : [
                  "dispatch",
                  "reschedule",
                  "cancel",
                  ...(can("manager") ? ["cancel_order"] : []),
                ]
            ).map((op) => (
              <Button
                key={op}
                variant={op.includes("cancel") ? "secondary" : "primary"}
                disabled={
                  action.busy ||
                  !action.online ||
                  (op === "dispatch" &&
                    (!data.goods_issued_at ||
                      data.payment_status !== "PAID"))
                }
                onClick={() => {
                  setOperation(op);
                  setActionNotes("");
                }}
              >
                {labels[op]}
              </Button>
            ))}
          </div>
        </section>
      )}
      {d && <DeliveryHistory id={d.id} />}
      <Dialog
        open={!!operation}
        onOpenChange={(open) => {
          if (!open && !action.busy) setOperation("");
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogTitle>{labels[operation] ?? "Update delivery"}</DialogTitle>
          <DialogDescription>
            {operation.includes("cancel")
              ? "This removes the delivery from all outstanding queues. Payment and stock remain recorded; arrange any refund or return separately."
              : operation === "complete"
                ? "Confirm the driver has delivered all listed goods. Record the recipient below."
                : "The change, date, comments and your user identity will be recorded in the delivery history."}
          </DialogDescription>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              send(operation, {
                date,
                reason,
                received_by: receivedBy,
                receiver_phone: receiverPhone,
                notes: actionNotes,
              });
            }}
          >
            <fieldset
              disabled={action.busy || !action.online}
              className="space-y-3"
            >
              {operation === "reschedule" && (
                <label className="block">
                  New delivery date
                  <Input
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </label>
              )}
              {operation === "complete" && (
                <>
                  <label className="block">
                    Received by
                    <Input
                      required
                      maxLength={150}
                      value={receivedBy}
                      onChange={(e) => setReceivedBy(e.target.value)}
                    />
                  </label>
                  <label className="block">
                    Receiver contact number
                    <Input
                      maxLength={80}
                      value={receiverPhone}
                      onChange={(e) => setReceiverPhone(e.target.value)}
                    />
                  </label>
                  <p className="text-sm text-muted">
                    Keep the signed driver copy as proof of delivery. Receiver
                    and driver signature spaces are on the printable note.
                  </p>
                </>
              )}
              {operation.includes("cancel") && (
                <label className="block">
                  Cancellation reason
                  <select
                    required
                    className="block w-full rounded border border-border bg-input p-2"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  >
                    <option value="">Select a reason</option>
                    {CANCELLATION_REASONS.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </label>
              )}
              <label className="block">
                {operation === "fail"
                  ? "Failure reason / notes"
                  : reason === "Other" && operation.includes("cancel")
                    ? "Explanation (required)"
                    : "Comments / notes"}
                <Input
                  required={
                    operation === "fail" ||
                    (operation.includes("cancel") && reason === "Other")
                  }
                  maxLength={2000}
                  value={actionNotes}
                  onChange={(e) => setActionNotes(e.target.value)}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" loading={action.busy}>
                  Confirm
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setOperation("")}
                >
                  Go back
                </Button>
              </div>
            </fieldset>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
