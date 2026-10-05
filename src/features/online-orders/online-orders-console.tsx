"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "@/lib/store-context";
import { createClient } from "@/lib/supabase/client";
import { money, dateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useBillingAction } from "@/features/billing/use-billing-action";
import type { OnlineOrder } from "./types";
import type { Json } from "@/lib/db/database.types";
export function OnlineOrdersConsole() {
  const { store } = useStore();
  const [cursors, setCursors] = useState<{ date: string; id: string }[]>([]);
  const cursor = cursors.at(-1);
  const { data, error, isFetching, refetch } = useQuery({
    queryKey: ["billing", "online-orders", store.id, cursor],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("online_orders_page", {
        p_store: store.id,
        ...(cursor ? { p_before: cursor.date, p_before_id: cursor.id } : {}),
      });
      if (error) throw error;
      return data as unknown as OnlineOrder[];
    },
  });
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap justify-between gap-3">
        <Button
          variant="secondary"
          disabled={isFetching}
          onClick={() => refetch()}
        >
          Refresh orders
        </Button>
      </div>
      {error && <p role="alert">Unable to load online orders.</p>}
      {data?.map((o) => (
        <OrderCard key={`${store.id}:${o.id}:${o.version}`} order={o} />
      ))}
      {data && !data.length && (
        <p className="rounded-xl border border-border p-6 text-muted">
          No online orders on this page.
        </p>
      )}
      <div className="flex gap-3">
        <Button
          variant="secondary"
          disabled={!cursors.length || isFetching}
          onClick={() => setCursors((c) => c.slice(0, -1))}
        >
          Previous
        </Button>
        <Button
          variant="secondary"
          disabled={data?.length !== 25 || isFetching}
          onClick={() => {
            const last = data!.at(-1)!;
            setCursors((c) => [...c, { date: last.date, id: last.id }]);
          }}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
function OrderCard({ order: o }: { order: OnlineOrder }) {
  const { canModule } = useStore();
  const { busy, run, request } = useBillingAction();
  const [action, setAction] = useState<string | null>(null);
  const paid = o.payment_status === "Payment Confirmed";
  const closed = ["CANCELLED", "EXPIRED", "COLLECTED", "DELIVERED"].includes(
    o.status,
  );
  function process(kind: string, details: Json = {}) {
    const payload = {
      p_order: o.id,
      p_expected: o.version,
      p_action: kind,
      p_details: details,
    };
    return run(
      () =>
        createClient().rpc("process_online_order", {
          ...payload,
          p_request: request(payload),
        }),
      "Online order updated",
      () => setAction(null),
    );
  }
  return (
    <article className="rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">
            {o.reference} · {o.customer}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {dateTime(o.date)} ·{" "}
            {o.fulfilment === "COLLECTION" ? "Collection" : "Delivery"}{" "}
            {o.scheduled_date} · {o.store}
          </p>
        </div>
        <div className="text-right">
          <p className="font-semibold">{money(o.total, o.currency)}</p>
          <p className="text-sm text-primary">
            {o.status.replaceAll("_", " ")}
          </p>
          <p className="text-xs text-muted">{o.payment_status}</p>
        </div>
      </div>
      <p className="mt-3 break-all text-sm">
        Payment reference: {o.payment_reference}
      </p>
      {o.cancellation_reason && (
        <p className="mt-2 text-sm">Cancellation: {o.cancellation_reason}</p>
      )}
      <details className="mt-3">
        <summary className="cursor-pointer text-sm text-primary">
          View items and tracking
        </summary>
        <div className="mt-3 space-y-2 text-sm">
          {o.lines.map((l, i) => (
            <p key={i}>
              {l.quantity} {l.unit} · {l.name} · {money(l.total, o.currency)}
            </p>
          ))}
          <p>
            {o.courier_company} {o.tracking_number}
          </p>
          {o.comments && <p className="whitespace-pre-wrap">{o.comments}</p>}
          {o.invoice_id && (
            <Link
              className="inline-block text-primary underline"
              href={`/invoices/${o.invoice_id}`}
            >
              Invoice {o.invoice_number}
            </Link>
          )}
          {o.delivery_number && (
            <Link
              className="ml-3 inline-block text-primary underline"
              href="/orders/deliveries"
            >
              Delivery {o.delivery_number}
            </Link>
          )}
        </div>
      </details>
      {o.goods_released &&
        o.fulfilment === "DELIVERY" &&
        canModule("orders_deliveries") && (
          <Button asChild className="mt-4">
            <Link href={`/orders/deliveries/${o.id}`}>Manage Delivery</Link>
          </Button>
        )}
      {canModule("orders_online_process") && !closed && (
        <div className="mt-4 flex flex-wrap gap-2">
          {!paid && (
            <Button
              disabled={busy}
              onClick={() => setAction("confirm_payment")}
            >
              Confirm payment
            </Button>
          )}
          {paid && (
            <Button
              disabled={busy || o.goods_released}
              onClick={() => process("processing")}
            >
              Processing
            </Button>
          )}
          {(paid || o.payment_option === "PAY_ON_COLLECTION") && (
            <Button
              disabled={busy || o.goods_released}
              onClick={() => process("ready")}
            >
              {o.fulfilment === "COLLECTION"
                ? "Ready for collection"
                : "Ready for delivery"}
            </Button>
          )}
          {o.fulfilment === "COLLECTION" &&
            paid &&
            o.status === "READY_FOR_COLLECTION" && (
              <Button disabled={busy} onClick={() => setAction("collect")}>
                Mark collected
              </Button>
            )}
          {o.fulfilment === "DELIVERY" && paid && (
            <Button
              disabled={busy || o.goods_released}
              onClick={() => setAction("release_delivery")}
            >
              {o.goods_released
                ? "Goods released for delivery"
                : "Release goods for delivery"}
            </Button>
          )}
          {o.fulfilment === "DELIVERY" && (
            <Button variant="secondary" onClick={() => setAction("tracking")}>
              Courier tracking
            </Button>
          )}
          {canModule("orders_approve") && (
            <Button disabled={busy} onClick={() => setAction("cancel")}>
              Cancel order
            </Button>
          )}
        </div>
      )}
      <Dialog
        open={action !== null}
        onOpenChange={(v) => {
          if (!v) setAction(null);
        }}
      >
        <DialogContent>
          <DialogTitle>
            {action === "confirm_payment"
              ? "Confirm received payment"
              : action === "tracking"
                ? "Courier tracking"
                : action === "cancel"
                  ? "Cancel online order"
                  : action === "release_delivery"
                    ? "Release reserved goods"
                    : "Confirm collection"}
          </DialogTitle>
          <DialogDescription>
            {action === "confirm_payment"
              ? `Verify that ${money(o.total, o.currency)} has actually been received. This creates and pays the invoice once.`
              : action === "cancel"
                ? "Cancellation releases outstanding reservations. Paid orders still require the existing approved refund or credit-note workflow; this action does not refund money."
                : action === "release_delivery"
                  ? "Reserved stock will be issued once. Dispatch, rescheduling and completion continue in Deliveries."
                  : "Confirm the details for this order."}
          </DialogDescription>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const details: Json =
                action === "confirm_payment"
                  ? { method: String(f.get("method")) }
                  : action === "tracking"
                    ? {
                        courier_company: String(f.get("company")),
                        tracking_number: String(f.get("number")),
                        tracking_url: String(f.get("url")),
                      }
                    : action === "cancel"
                      ? { reason: String(f.get("reason")) }
                      : {};
              process(action!, details);
            }}
          >
            {action === "confirm_payment" && (
              <>
                <label>
                  Payment method
                  <select
                    name="method"
                    className="mt-1 w-full rounded-lg border border-border bg-background p-3"
                  >
                    <option value="CARD_EFT">
                      Verified bank transfer / card
                    </option>
                    {o.fulfilment === "COLLECTION" && (
                      <option value="CASH">Cash received at collection</option>
                    )}
                  </select>
                </label>
                <label className="flex items-center gap-3">
                  <input type="checkbox" required />I have verified the funds
                  were received.
                </label>
              </>
            )}
            {action === "tracking" && (
              <>
                <label>
                  Courier company
                  <Input
                    name="company"
                    maxLength={150}
                    defaultValue={o.courier_company || ""}
                  />
                </label>
                <label>
                  Tracking number
                  <Input
                    name="number"
                    maxLength={150}
                    defaultValue={o.tracking_number || ""}
                  />
                </label>
                <label>
                  Customer tracking URL
                  <Input
                    name="url"
                    type="url"
                    pattern="https://.*"
                    maxLength={1000}
                    defaultValue={o.tracking_url || ""}
                  />
                </label>
              </>
            )}
            {action === "cancel" && (
              <label>
                Cancellation reason
                <Input name="reason" required maxLength={1000} />
              </label>
            )}
            <Button type="submit" disabled={busy}>
              Confirm
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </article>
  );
}
