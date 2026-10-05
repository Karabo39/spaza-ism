"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { customerRequest } from "./api";
import type { OnlineOrder } from "./types";
import { money, dateTime } from "@/lib/format";
export function CustomerTracking({
  link,
  order,
}: {
  link: string;
  order: string;
}) {
  const [data, setData] = useState<OnlineOrder | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function refresh() {
    setBusy(true);
    setError("");
    try {
      setData(
        await customerRequest<OnlineOrder>({
          action: "status",
          link,
          order,
          secret: window.location.hash.slice(1),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let active = true;
    customerRequest<OnlineOrder>({
      action: "status",
      link,
      order,
      secret: window.location.hash.slice(1),
    })
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [link, order]);
  return (
    <main className="min-h-screen bg-background px-5 py-12">
      <div className="mx-auto max-w-3xl space-y-6">
        <p className="text-sm font-semibold uppercase tracking-widest text-primary">
          POS INVENTORY · {data?.store || "Private order tracking"}
        </p>
        <h1 className="text-3xl font-semibold">
          {data ? "Order placed successfully" : "Your order"}
        </h1>
        <p className="text-muted">
          Save this complete private link. Keep it private; it is the key to
          your order.
        </p>
        {error && (
          <p role="alert" className="rounded-xl border border-border p-4">
            {error}
          </p>
        )}
        {data && (
          <>
            <section className="rounded-2xl border border-border bg-surface p-6">
              <p className="font-semibold">
                {data.reference} · {data.customer}
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-muted">Order status</p>
                  <p className="font-medium">
                    {data.status.replaceAll("_", " ")}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted">Payment</p>
                  <p>{data.payment_status}</p>
                </div>
                <div>
                  <p className="text-xs text-muted">
                    {data.fulfilment === "COLLECTION"
                      ? "Collection"
                      : "Delivery"}{" "}
                    date
                  </p>
                  <p>{data.scheduled_date}</p>
                </div>
                <div>
                  <p className="text-xs text-muted">Order total</p>
                  <p className="text-xl font-semibold">
                    {money(data.total, data.currency)}
                  </p>
                </div>
              </div>
              {data.cancellation_reason && (
                <p className="mt-4">Reason: {data.cancellation_reason}</p>
              )}
              {data.fulfilment === "COLLECTION" && (
                <p className="mt-4 text-sm">
                  Collection at {data.store_address || data.store}.
                </p>
              )}
              {data.invoice_number && (
                <p className="mt-3 text-sm">Invoice: {data.invoice_number}</p>
              )}
              {data.delivery_number && (
                <p className="mt-2 text-sm">
                  Delivery note: {data.delivery_number}
                </p>
              )}
            </section>
            {data.payment_status !== "Payment Confirmed" &&
              !["CANCELLED", "EXPIRED"].includes(data.status) && (
                <section className="rounded-2xl border border-border bg-surface p-6">
                  <h2 className="font-semibold">
                    {data.payment_option === "PAY_ON_COLLECTION"
                      ? "Payment on collection"
                      : "Bank transfer instructions"}
                  </h2>
                  <p className="mt-3">
                    Payment reference:{" "}
                    <strong className="break-all">
                      {data.payment_reference}
                    </strong>
                  </p>
                  <p className="mt-3 whitespace-pre-wrap">
                    {data.payment_instructions}
                  </p>
                  <p className="mt-4 text-sm text-muted">
                    Use this reference when paying into the store&apos;s bank
                    account. Your order will be processed and shipped only after
                    confirmed payment.{" "}
                    {data.payment_option === "PAY_ON_COLLECTION"
                      ? "For collection, the store can reserve your items for payment when you arrive."
                      : ""}{" "}
                    Unpaid reservation ends {dateTime(data.expires_at)}.
                  </p>
                </section>
              )}
            <section className="rounded-2xl border border-border bg-surface p-6">
              <h2 className="mb-4 font-semibold">Items</h2>
              <div className="divide-y divide-border">
                {data.lines.map((l, i) => (
                  <div key={i} className="flex justify-between gap-3 py-3">
                    <span>
                      {l.quantity} {l.unit} · {l.name}
                    </span>
                    <span>{money(l.total, data.currency)}</span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-sm text-muted">
                Delivery {money(data.delivery_fee, data.currency)} · Tax{" "}
                {data.tax_percent}%
              </p>
            </section>
            {data.fulfilment === "DELIVERY" &&
              (data.courier_company ||
                data.tracking_number ||
                data.tracking_url) && (
                <section className="rounded-2xl border border-border bg-surface p-6">
                  <h2 className="font-semibold">Courier tracking</h2>
                  <p className="mt-3">
                    {data.courier_company} · {data.tracking_number}
                  </p>
                  {data.tracking_url?.startsWith("https://") && (
                    <a
                      className="mt-3 inline-block text-primary underline"
                      href={data.tracking_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Track with courier
                    </a>
                  )}
                </section>
              )}
            {data.comments && (
              <p className="whitespace-pre-wrap text-sm text-muted">
                {data.comments}
              </p>
            )}
          </>
        )}
        <div className="flex gap-3">
          <Button disabled={busy} onClick={refresh}>
            {busy ? "Refreshing…" : "Refresh status"}
          </Button>
          <Link
            className="rounded-lg border border-border px-4 py-3 text-sm"
            href={`/shop/${link}`}
          >
            Back to store
          </Link>
        </div>
      </div>
    </main>
  );
}
