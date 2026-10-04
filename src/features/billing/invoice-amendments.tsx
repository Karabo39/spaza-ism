"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { LocationProductPicker } from "@/features/operations/product-picker";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store-context";
import { money, dateTime } from "@/lib/format";
import type {
  InvoiceBalance,
  SalesInvoiceItem,
  ProductStock,
} from "@/lib/db/database.types";
import { orderTotals } from "./order-totals";
import { useBillingAction } from "./use-billing-action";

type Revision = {
  id: string;
  revision: number;
  reason: string;
  amount_change: number;
  created_at: string;
  actor: string;
  before_data: { invoice: { total: number }; items: SalesInvoiceItem[] };
  after_data: { items: SalesInvoiceItem[]; totals: { total: number } };
};
export function InvoiceAmendments({
  invoice: i,
  items,
}: {
  invoice: InvoiceBalance;
  items: SalesInvoiceItem[];
}) {
  const { can, store, currency } = useStore();
  const action = useBillingAction();
  const [open, setOpen] = useState(false),
    [history, setHistory] = useState(false);
  const [lines, setLines] = useState(
    items.map((x) => ({
      product_id: x.product_id,
      product_name: x.product_name,
      quantity: Number(x.quantity),
      unit_price: Number(x.unit_price),
    })),
  );
  const [product, setProduct] = useState<ProductStock | null>(null),
    [reason, setReason] = useState("");
  const [discount, setDiscount] = useState(Number(i.discount));
  const totals = orderTotals(
    lines,
    discount,
    Number(i.tax_percent),
    Number(i.delivery_fee ?? 0),
  );
  const outstanding = totals.total - Number(i.paid);
  const editable =
    can("manager", "invoices_manage") &&
    !i.goods_issued_at &&
    ["DRAFT", "ISSUED"].includes(i.state) &&
    Number(i.credits) === 0 &&
    Number(i.debits) === 0;
  const revisions = useQuery({
    queryKey: ["billing", "invoice-revisions", i.id],
    enabled: history,
    queryFn: async () => {
      const { data, error } = await createClient().rpc(
        "invoice_revision_history",
        { p_invoice: i.id },
      );
      if (error) throw error;
      return data as unknown as Revision[];
    },
  });
  return (
    <section className="space-y-3 rounded-lg border border-border p-4">
      <h2 className="font-semibold">Order item corrections</h2>
      {!i.goods_issued_at && (
        <p className="text-sm">
          Stock unavailable? An authorised user can edit quantities, remove or replace
          products, or add items here. The order and invoice numbers stay the
          same. Payments and previous document versions remain recorded.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {editable && (
          <Button
            variant="secondary"
            disabled={!action.online}
            onClick={() => setOpen(true)}
          >
            Edit order items
          </Button>
        )}
        <Button
          variant="secondary"
          aria-expanded={history}
          onClick={() => setHistory(!history)}
        >
          Revision history{i.revision ? ` (${i.revision})` : ""}
        </Button>
      </div>
      {history && (
        <div className="space-y-3">
          {revisions.isLoading && <p>Loading revisions...</p>}
          {revisions.error && (
            <p role="alert">
              Could not load revisions.{" "}
              <Button onClick={() => revisions.refetch()}>Retry</Button>
            </p>
          )}
          {revisions.data?.length === 0 && <p>No item corrections recorded.</p>}
          {revisions.data?.map((r) => (
            <details key={r.id} className="rounded border border-border p-3">
              <summary>
                Revision {r.revision} · {dateTime(r.created_at)} ·{" "}
                {money(r.amount_change, currency)}
              </summary>
              <p>
                {r.actor} · {r.reason}
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                {[
                  ["Before", r.before_data.items, r.before_data.invoice.total],
                  ["After", r.after_data.items, r.after_data.totals.total],
                ].map(([label, rows, total]) => (
                  <div key={String(label)}>
                    <h3 className="font-semibold">
                      {String(label)} · {money(Number(total), currency)}
                    </h3>
                    {(rows as SalesInvoiceItem[]).map((l) => (
                      <p key={l.product_id}>
                        {l.quantity} × {l.product_name} ·{" "}
                        {money(Number(l.unit_price), currency)}
                      </p>
                    ))}
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogTitle>Edit order items</DialogTitle>
          <DialogDescription>
            Existing items keep their agreed unit prices. New items use this
            store’s current price. No stock is moved until Release invoice goods
            succeeds.
          </DialogDescription>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const payload = {
                p_invoice: i.id,
                p_expected: i.revision ?? 0,
                p_items: lines.map((l) => ({
                  product_id: l.product_id,
                  quantity: l.quantity,
                  unit_price: l.unit_price,
                })),
                p_discount: discount,
                p_reason: reason.trim(),
              };
              void action.run(
                () =>
                  createClient().rpc("amend_invoice_items", {
                    ...payload,
                    p_request: action.request(payload),
                  }),
                "Order items updated; payment history preserved",
                () => setOpen(false),
              );
            }}
          >
            <fieldset
              disabled={action.busy || !action.online}
              className="space-y-4"
            >
              {lines.map((l) => (
                <div
                  key={l.product_id}
                  className="flex flex-wrap items-end gap-2 border-b border-border pb-3"
                >
                  <label className="min-w-0 flex-1">
                    {l.product_name} · {money(l.unit_price, currency)} each
                    <Input
                      aria-label={`Quantity for ${l.product_name}`}
                      type="number"
                      min="0.001"
                      step="0.001"
                      required
                      value={l.quantity}
                      onChange={(e) =>
                        setLines(
                          lines.map((x) =>
                            x.product_id === l.product_id
                              ? { ...x, quantity: Number(e.target.value) }
                              : x,
                          ),
                        )
                      }
                    />
                  </label>
                  <Button
                    type="button"
                    variant="danger"
                    onClick={() =>
                      setLines(
                        lines.filter((x) => x.product_id !== l.product_id),
                      )
                    }
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <LocationProductPicker
                location={store.id}
                label="Add or replace product"
                searchable
                value={product}
                onChange={setProduct}
              />
              <Button
                type="button"
                disabled={!product}
                onClick={() => {
                  if (!product) return;
                  const existing = items.find(
                    (x) => x.product_id === product.id,
                  );
                  setLines(
                    lines.some((x) => x.product_id === product.id)
                      ? lines.map((x) =>
                          x.product_id === product.id
                            ? { ...x, quantity: x.quantity + 1 }
                            : x,
                        )
                      : [
                          ...lines,
                          {
                            product_id: product.id,
                            product_name: product.name,
                            quantity: 1,
                            unit_price: Number(
                              existing?.unit_price ?? product.selling_price,
                            ),
                          },
                        ],
                  );
                  setProduct(null);
                }}
              >
                Add product
              </Button>
              <label className="block">
                Invoice discount
                <Input
                  aria-label="Invoice discount"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={discount}
                  onChange={(e) => setDiscount(Number(e.target.value))}
                />
              </label>
              <label className="block">
                Reason for correction
                <Input
                  required
                  maxLength={1000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <p>
                Revised total: {money(totals.total, currency)} · Payments
                retained: {money(Number(i.paid), currency)}
              </p>
              {i.state === "ISSUED" && (
                <p>
                  {outstanding < 0
                    ? `Customer credit after correction: ${money(-outstanding, currency)}. No automatic cash refund is made.`
                    : `Amount still due: ${money(outstanding, currency)}`}
                </p>
              )}
              {!totals.valid && (
                <p role="alert">
                  The discount must be between zero and the subtotal.
                </p>
              )}
              <Button
                type="submit"
                loading={action.busy}
                disabled={
                  !lines.length ||
                  !totals.valid ||
                  !reason.trim() ||
                  lines.some(
                    (l) => !Number.isFinite(l.quantity) || l.quantity <= 0,
                  )
                }
              >
                Save corrected order
              </Button>
            </fieldset>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
