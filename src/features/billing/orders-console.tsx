"use client";
import { statusLabel } from "./status-label";
import { PurchaseOrder } from "./purchase-order";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { CustomerPicker } from "@/features/credit/customer-picker";
import { LocationProductPicker } from "@/features/operations/product-picker";
import { useBillingAction } from "./use-billing-action";
import { money, dateTime } from "@/lib/format";
import { businessDate } from "@/lib/business-date";
import type { OrderWorkflow } from "./order-workflow";
import { orderTotals } from "./order-totals";
import type { CreditCustomer, ProductStock } from "@/lib/db/database.types";
type Line = {
  product_id: string;
  name: string;
  quantity: number;
  unit_price: number;
};
export function OrdersConsole({
  initialOrder,
}: { initialOrder?: string } = {}) {
  const { store, currency, canModule } = useStore();
  const router = useRouter();
  const { online, busy, request, run } = useBillingAction();
  const [customer, setCustomer] = useState<CreditCustomer | null>(null);
  const [guestMode, setGuestMode] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [guestAddress, setGuestAddress] = useState("");
  const [pickCustomer, setPickCustomer] = useState(false);
  const [product, setProduct] = useState<ProductStock | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [lines, setLines] = useState<Line[]>([]);
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState<OrderWorkflow | null>(null);
  const [due, setDue] = useState(businessDate());
  const [terms, setTerms] = useState("CASH");
  const [discount, setDiscount] = useState(0);
  const [reason, setReason] = useState("");
  const { data: orders, error } = useQuery({
    queryKey: ["billing", "orders", store.id],
    queryFn: async () => {
      const { data, error } = await createClient().rpc(
        "order_workflow_summary",
        { p_store: store.id },
      );
      if (error) throw error;
      return data as unknown as OrderWorkflow[];
    },
  });
  const current =
    orders?.find((o) => o.id === selected?.id) ??
    selected ??
    orders?.find((o) => o.id === initialOrder) ??
    null;
  const { data: items } = useQuery({
    queryKey: ["billing", "order-items", current?.id],
    enabled: !!current,
    queryFn: async () => {
      const { data, error } = await createClient()
        .from("sales_order_items")
        .select("*")
        .eq("order_id", current!.id);
      if (error) throw error;
      return data;
    },
  });
  const billing = useQuery({
    queryKey: ["billing", "order-tax", store.businessId],
    queryFn: async () => {
      const { data, error } = await createClient()
        .from("billing_settings")
        .select("tax_percent")
        .eq("business_id", store.businessId)
        .maybeSingle();
      if (error) throw error;
      return Number(data?.tax_percent ?? 0);
    },
  });
  const draftTotals = orderTotals(lines, 0, billing.data ?? 0);
  const invoiceTotals = orderTotals(
    (items ?? []).map((i) => ({
      quantity: Number(i.quantity),
      unit_price: Number(i.unit_price),
    })),
    Number(current?.quoted_discount ?? discount),
    Number(current?.quoted_tax_percent ?? billing.data ?? 0),
  );
  function add() {
    if (
      !product ||
      quantity <= 0 ||
      !Number.isFinite(quantity) ||
      Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 0.000001
    )
      return;
    setLines((old) =>
      old.some((l) => l.product_id === product.id)
        ? old.map((l) =>
            l.product_id === product.id
              ? { ...l, quantity: l.quantity + quantity }
              : l,
          )
        : [
            ...old,
            {
              product_id: product.id,
              name: product.name,
              quantity,
              unit_price: Number(product.selling_price),
            },
          ],
    );
    setProduct(null);
    setQuantity(1);
  }
  async function createInvoice() {
    if (!current || current.invoice || current.status !== "CONFIRMED") return;
    await run(async () => {
      const res = await createClient().rpc("create_sales_invoice", {
        p_order: current.id,
        p_due: due,
        p_terms: terms === "PAY_DELIVER" ? "CASH" : terms,
        p_discount: discount,
      });
      if (res.data) router.push(`/invoices/${res.data}`);
      return res;
    }, "Invoice draft created");
  }
  return (
    <div className="space-y-6">
      {!online && (
        <p className="text-warning">
          Orders and invoices require a connection.
        </p>
      )}
      {store.locationType !== "warehouse" && (
        <section className="space-y-4 rounded-lg border border-border bg-surface p-5">
          <div className="flex justify-between">
            <h2 className="font-semibold">New order</h2>
            <Button
              variant="secondary"
              onClick={() => {
                setGuestMode(false);
                setPickCustomer(true);
              }}
            >
              {customer?.name ?? "Choose customer"}
            </Button>
          </div>
          <Button
            aria-pressed={guestMode}
            variant={guestMode ? "primary" : "secondary"}
            onClick={() => {
              setGuestMode(true);
              setCustomer(null);
            }}
          >
            One-off customer
          </Button>
          {guestMode && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label>
                Customer name
                <Input
                  required
                  maxLength={200}
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                />
              </label>
              <label>
                Contact number (optional)
                <Input
                  maxLength={50}
                  value={guestPhone}
                  onChange={(e) => setGuestPhone(e.target.value)}
                />
              </label>
              <label className="sm:col-span-2">
                Address (optional)
                <Input
                  maxLength={1000}
                  value={guestAddress}
                  onChange={(e) => setGuestAddress(e.target.value)}
                />
              </label>
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-[1fr_9rem]">
            <LocationProductPicker
              location={store.id}
              label="Order product"
              searchable
              value={product}
              onChange={setProduct}
            />
            <div>
              <Label htmlFor="order-quantity">Quantity</Label>
              <Input
                id="order-quantity"
                type="number"
                min="0.001"
                step="0.001"
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
              />
              <Button
                className="mt-3 w-full"
                variant="secondary"
                onClick={add}
                disabled={
                  !product ||
                  quantity <= 0 ||
                  !Number.isFinite(quantity) ||
                  Math.abs(quantity * 1000 - Math.round(quantity * 1000)) >
                    0.000001
                }
              >
                Add item
              </Button>
            </div>
          </div>
          {lines.map((l) => (
            <div
              key={l.product_id}
              className="flex items-center justify-between border-b border-border py-2 text-sm"
            >
              <span>
                {l.quantity} × {l.name} ·{" "}
                {money(l.quantity * l.unit_price, currency)}
              </span>
              <Button
                variant="ghost"
                onClick={() =>
                  setLines((old) =>
                    old.filter((x) => x.product_id !== l.product_id),
                  )
                }
              >
                Remove
              </Button>
            </div>
          ))}
          <Label htmlFor="order-note">Order note (optional)</Label>
          <Input
            id="order-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <p className="text-sm">
            Subtotal: {money(draftTotals.subtotal, currency)} · Tax (
            {billing.data ?? 0}%): {money(draftTotals.tax, currency)} ·
            Estimated total: {money(draftTotals.total, currency)}. Choose any
            invoice discount after confirming the order.
          </p>
          {billing.error && (
            <p role="alert" className="text-danger">
              Tax settings could not be loaded. Refresh to confirm the estimate.
            </p>
          )}
          <Button
            loading={busy}
            disabled={
              !online ||
              (guestMode ? !guestName.trim() : !customer) ||
              !lines.length
            }
            onClick={() => {
              const payload = {
                p_store: store.id,
                p_customer: guestMode ? null : customer!.customer_id,
                p_guest: guestMode
                  ? {
                      name: guestName.trim(),
                      phone: guestPhone.trim(),
                      address: guestAddress.trim(),
                    }
                  : null,
                p_items: lines.map(({ product_id, quantity, unit_price }) => ({
                  product_id,
                  quantity,
                  unit_price,
                })),
                p_note: note,
              };
              void run(
                () =>
                  createClient().rpc("create_order_with_contact", {
                    ...payload,
                    p_request: request(payload),
                  }),
                "Order draft saved",
                () => {
                  setLines([]);
                  setCustomer(null);
                  setGuestMode(false);
                  setGuestName("");
                  setGuestPhone("");
                  setGuestAddress("");
                  setNote("");
                },
              );
            }}
          >
            Save order draft
          </Button>
        </section>
      )}
      <div className="flex justify-between">
        <h2 className="font-semibold">Recent orders</h2>
        {canModule("invoices") && (
          <Button asChild>
            <Link href="/invoices">View invoices</Link>
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-danger">
          Could not load orders.
        </p>
      )}
      {orders?.length === 200 && (
        <p className="text-sm text-muted">Latest 200 orders.</p>
      )}
      <Table>
        <THead>
          <TR>
            <TH>Reference</TH>
            <TH>Customer</TH>
            <TH>Status</TH>
            <TH>Created</TH>
          </TR>
        </THead>
        <TBody>
          {orders?.map((o) => (
            <TR key={o.id}>
              <TD>
                <button
                  className="text-accent text-left"
                  onClick={() => {
                    setSelected(o);
                    setDiscount(Number(o.quoted_discount ?? 0));
                    setReason("");
                  }}
                >
                  {o.reference}
                </button>
              </TD>
              <TD>{o.customer_name}</TD>
              <TD>{statusLabel(o.status)}</TD>
              <TD>{dateTime(o.created_at)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
      {current && (
        <section className="space-y-4 rounded-lg border border-border bg-surface p-5">
          <h2 className="font-semibold">
            {current.reference} · {statusLabel(current.status)}
          </h2>
          <p>
            {current.customer_name} · {current.note}
          </p>
          {items?.map((l) => (
            <p key={l.id} className="text-sm">
              {l.quantity} × {l.product_name} — {money(l.line_total, currency)}
            </p>
          ))}
          {current.invoice ? (
            <section
              aria-label="Order summary"
              className="rounded-lg border border-border p-4 space-y-3"
            >
              <h3 className="font-semibold">Order summary</h3>
              <p className="break-all">Invoice {current.invoice.reference}</p>
              <p>
                Payment: {statusLabel(current.invoice.status)} ·{" "}
                {current.invoice.goods_issued_at
                  ? `Goods released ${dateTime(current.invoice.goods_issued_at)}`
                  : "Awaiting goods release"}
              </p>
              <div className="grid gap-3 sm:grid-cols-4">
                {[
                  ["Invoice total", current.invoice.total],
                  ["Payments", current.invoice.paid],
                  ["Credit notes", current.invoice.credits],
                  ["Outstanding", current.invoice.outstanding],
                ].map(([label, value]) => (
                  <div key={label}>
                    <p className="text-sm text-muted">{label}</p>
                    <p className="font-semibold">
                      {money(Number(value), currency)}
                    </p>
                  </div>
                ))}
              </div>
              {canModule("invoices") && (
                <Link
                  className="text-accent"
                  href={`/invoices/${current.invoice.id}`}
                >
                  View invoice and payment history
                </Link>
              )}
            </section>
          ) : (
            <p className="text-sm">
              Subtotal: {money(invoiceTotals.subtotal, currency)} · Discount:{" "}
              {money(invoiceTotals.discount, currency)} · Tax (
              {current.quoted_tax_percent ?? billing.data ?? 0}
              %): {money(invoiceTotals.tax, currency)} · Estimated invoice
              total: {money(invoiceTotals.total, currency)}. Final amounts are
              shown on the generated invoice.
            </p>
          )}
          {!current.invoice && !invoiceTotals.valid && (
            <p role="alert" className="text-danger">
              The discount must be between zero and the subtotal.
            </p>
          )}
          {current.status === "DRAFT" && (
            <Button
              loading={busy}
              disabled={!online}
              onClick={() =>
                run(
                  () =>
                    createClient().rpc("process_sales_order", {
                      p_order: current.id,
                      p_action: "confirm",
                    }),
                  "Order confirmed",
                )
              }
            >
              Confirm order
            </Button>
          )}
          {current.status === "CONFIRMED" && !current.invoice && (
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="invoice-due">Payment due</Label>
                <Input
                  id="invoice-due"
                  type="date"
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="invoice-terms">Payment terms</Label>
                <select
                  id="invoice-terms"
                  className="h-10 w-full rounded border border-border bg-input px-2"
                  value={terms}
                  onChange={(e) => setTerms(e.target.value)}
                >
                  <option value="CASH">Cash before collection</option>
                  <option value="CARD_EFT">Card/EFT before collection</option>
                  <option value="CREDIT">Customer credit account</option>
                  <option value="PAY_DELIVER">Pay – To be Delivered</option>
                </select>
              </div>
              <div>
                <Label htmlFor="invoice-discount">Discount amount</Label>
                <Input
                  id="invoice-discount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={discount}
                  disabled={current.quoted_discount != null}
                  onChange={(e) => setDiscount(Number(e.target.value))}
                />
              </div>
              {terms === "PAY_DELIVER" && (
                <p className="text-sm text-muted">
                  Create the invoice and record payment next. It becomes Paid –
                  To be Delivered only after full payment; release goods when
                  delivered.
                </p>
              )}
              <Button
                loading={busy}
                disabled={
                  !online ||
                  !due ||
                  !invoiceTotals.valid ||
                  billing.data === undefined
                }
                onClick={createInvoice}
              >
                Create invoice
              </Button>
            </div>
          )}
          {current.can_cancel && (
            <div className="flex gap-2">
              <Input
                aria-label="Order cancellation reason"
                placeholder="Cancellation reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <Button
                variant="secondary"
                disabled={!online || busy || !reason.trim()}
                onClick={() =>
                  run(
                    () =>
                      createClient().rpc("process_sales_order", {
                        p_order: current.id,
                        p_action: "cancel",
                        p_reason: reason,
                      }),
                    "Order cancelled",
                  )
                }
              >
                Cancel order
              </Button>
            </div>
          )}
          {current.status === "DRAFT" && <PurchaseOrder order={current.id} />}
        </section>
      )}
      <CustomerPicker
        open={pickCustomer}
        onOpenChange={setPickCustomer}
        onSelect={setCustomer}
      />
    </div>
  );
}
