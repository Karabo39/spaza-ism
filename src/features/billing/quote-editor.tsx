"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CustomerPicker } from "@/features/credit/customer-picker";
import { LocationProductPicker } from "@/features/operations/product-picker";
import { useBillingAction } from "./use-billing-action";
import { orderTotals } from "./order-totals";
import { businessDate } from "@/lib/business-date";
import { money } from "@/lib/format";
import type {
  SalesQuote,
  QuoteLine,
  ProductStock,
} from "@/lib/db/database.types";

export function QuoteEditor({
  quote,
  saved,
  cancel,
}: {
  quote?: SalesQuote;
  saved: (id: string) => void;
  cancel: () => void;
}) {
  const { store, currency } = useStore();
  const { online, busy, run, request } = useBillingAction();
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(
    quote ? { id: quote.customer_id, name: quote.customer_name } : null,
  );
  const [pick, setPick] = useState(false);
  const [product, setProduct] = useState<ProductStock | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [lines, setLines] = useState<QuoteLine[]>(quote?.items ?? []);
  const [valid, setValid] = useState(
    () =>
      quote?.valid_until ?? businessDate(new Date(Date.now() + 30 * 86400000)),
  );
  const [discount, setDiscount] = useState(Number(quote?.discount ?? 0));
  const [note, setNote] = useState(quote?.note ?? "");
  const settings = useQuery({
    queryKey: ["billing", "quote-tax", store.businessId],
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
  const tax = quote?.tax_percent ?? settings.data ?? 0;
  const totals = orderTotals(lines, discount, Number(tax));
  function add() {
    if (
      !product ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
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
              unit: product.unit,
              quantity,
              unit_price: Number(product.selling_price),
              line_total: 0,
            },
          ],
    );
    setProduct(null);
    setQuantity(1);
  }
  async function save() {
    const payload = {
      p_store: store.id,
      p_customer: customer!.id,
      p_items: lines.map((l) => ({
        product_id: l.product_id,
        quantity: l.quantity,
        unit_price: l.unit_price,
      })),
      p_valid: valid,
      p_discount: discount,
      p_note: note,
      ...(quote ? { p_quote: quote.id, p_expected: quote.version } : {}),
    };
    await run(async () => {
      const result = await createClient().rpc("save_quote", {
        ...payload,
        p_request: request(payload),
      });
      if (!result.error && result.data) saved(result.data);
      return result;
    }, "Quotation saved");
  }
  return (
    <section className="space-y-4 rounded-xl border border-border bg-surface p-5">
      <h2 className="text-lg font-semibold">
        {quote ? "Edit draft quotation" : "New quotation"}
      </h2>
      <p className="text-sm text-muted-foreground">
        A quotation does not reserve stock, reduce quantities or create customer
        debt. Out-of-stock items can be quoted.
      </p>
      <Button variant="secondary" onClick={() => setPick(true)}>
        {customer?.name ?? "Choose customer"}
      </Button>
      <CustomerPicker
        open={pick}
        onOpenChange={setPick}
        onSelect={(c) => {
          setCustomer({ id: c.customer_id, name: c.name });
          setPick(false);
        }}
      />
      <div className="grid gap-3 md:grid-cols-3">
        <div className="md:col-span-2">
          <LocationProductPicker
            searchable
            location={store.id}
            label="Quote product"
            value={product}
            onChange={setProduct}
          />
        </div>
        <label>
          Quantity
          <Input
            type="number"
            min="0.001"
            step="0.001"
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
          />
        </label>
      </div>
      <Button
        variant="secondary"
        disabled={!product || quantity <= 0}
        onClick={add}
      >
        Add product
      </Button>
      {lines.map((l, index) => (
        <div
          key={l.product_id}
          className="flex flex-wrap items-center gap-3 border-b border-border pb-3"
        >
          <span className="grow">{l.name}</span>
          <Input
            className="w-28"
            aria-label={`Quantity for ${l.name}`}
            type="number"
            min="0.001"
            step="0.001"
            value={l.quantity}
            onChange={(e) =>
              setLines((old) =>
                old.map((x, i) =>
                  i === index ? { ...x, quantity: Number(e.target.value) } : x,
                ),
              )
            }
          />
          <Input
            className="w-32"
            aria-label={`Quoted price for ${l.name}`}
            type="number"
            min="0"
            step="0.01"
            value={l.unit_price}
            onChange={(e) =>
              setLines((old) =>
                old.map((x, i) =>
                  i === index
                    ? { ...x, unit_price: Number(e.target.value) }
                    : x,
                ),
              )
            }
          />
          <Button
            variant="ghost"
            onClick={() => setLines((old) => old.filter((_, i) => i !== index))}
          >
            Remove
          </Button>
        </div>
      ))}
      <div className="grid gap-3 md:grid-cols-2">
        <label>
          Valid until
          <Input
            type="date"
            value={valid}
            min={businessDate()}
            onChange={(e) => setValid(e.target.value)}
          />
        </label>
        <label>
          Discount amount
          <Input
            type="number"
            min="0"
            step="0.01"
            value={discount}
            onChange={(e) => setDiscount(Number(e.target.value))}
          />
        </label>
      </div>
      <label className="block">
        Notes
        <Input value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <p>
        Subtotal {money(totals.subtotal, currency)} · Discount{" "}
        {money(totals.discount, currency)} · Tax {tax}%:{" "}
        {money(totals.tax, currency)} · Total{" "}
        <strong>{money(totals.total, currency)}</strong>
      </p>
      {settings.error && <p role="alert">Could not load tax settings.</p>}
      <div className="flex gap-3">
        <Button
          loading={busy}
          disabled={
            !online ||
            !customer ||
            !lines.length ||
            !totals.valid ||
            !valid ||
            valid < businessDate() ||
            settings.isLoading ||
            !!settings.error
          }
          onClick={save}
        >
          Save quotation
        </Button>
        <Button variant="secondary" onClick={cancel}>
          Close
        </Button>
      </div>
    </section>
  );
}
