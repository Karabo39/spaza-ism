"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CustomerPicker } from "@/features/credit/customer-picker";
import { LocationProductPicker } from "@/features/operations/product-picker";
import { ExportButton } from "@/features/reports/export-button";
import { useBillingAction } from "./use-billing-action";
import { PurchaseOrder } from "./purchase-order";
import { orderTotals } from "./order-totals";
import { businessDate } from "@/lib/business-date";
import { money } from "@/lib/format";
import type {
  SalesQuote,
  QuoteLine,
  ProductStock,
} from "@/lib/db/database.types";

export function QuotesConsole() {
  const { store, currency } = useStore();
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const query = useQuery({
    queryKey: ["billing", "quotes", store.id, search],
    queryFn: async () => {
      const { data, error } = await createClient()
        .from("sales_quotes")
        .select("*")
        .eq("store_id", store.id)
        .ilike("customer_name", `%${search}%`)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });
  const current = query.data?.find((q) => q.id === selected);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-3">
        <Button
          onClick={() => {
            setSelected(null);
            setCreating(true);
          }}
        >
          Create quotation
        </Button>
        <Input
          aria-label="Search quotations by customer"
          placeholder="Search customer"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {creating ? (
        <QuoteEditor
          key={`new:${store.id}`}
          saved={(id) => {
            setSelected(id);
            setCreating(false);
          }}
          cancel={() => setCreating(false)}
        />
      ) : current ? (
        <QuoteDetail key={`${current.id}:${current.version}`} quote={current} />
      ) : null}
      {query.error ? (
        <p role="alert">
          Could not load quotations.{" "}
          <Button onClick={() => query.refetch()}>Retry</Button>
        </p>
      ) : query.isLoading ? (
        <p>Loading quotations...</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {query.data?.map((q) => (
            <button
              className="rounded-lg border border-border bg-surface p-4 text-left hover:border-primary"
              key={q.id}
              onClick={() => {
                setSelected(q.id);
                setCreating(false);
              }}
            >
              <p className="font-semibold break-all">{q.reference}</p>
              <p>
                {q.customer_name} · {money(q.total, currency)}
              </p>
              <p className="text-sm text-muted-foreground">
                {quoteStatus(q)} · Valid until {q.valid_until}
              </p>
            </button>
          ))}
        </div>
      )}
      {query.data?.length === 0 && <p>No quotations found.</p>}
      {query.data?.length === 200 && (
        <p>
          Showing the latest 200 quotations. Search by customer to narrow the
          results.
        </p>
      )}
    </div>
  );
}
function quoteStatus(q: SalesQuote) {
  return !["CONVERTED", "CANCELLED"].includes(q.status) &&
    q.valid_until < businessDate()
    ? "EXPIRED"
    : q.status;
}
function QuoteEditor({
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
function QuoteDetail({ quote: q }: { quote: SalesQuote }) {
  const { store, currency, canModule } = useStore();
  const { online, busy, run } = useBillingAction();
  const [edit, setEdit] = useState(false);
  const [convert, setConvert] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, number>>(
    Object.fromEntries(q.items.map((l) => [l.product_id, Number(l.quantity)])),
  );
  const stock = useQuery({
    queryKey: ["billing", "quote-stock", q.id],
    enabled: convert,
    queryFn: async () => {
      const { data, error } = await createClient()
        .from("v_product_stock")
        .select("id,quantity,is_active")
        .eq("store_id", store.id)
        .in(
          "id",
          q.items.map((l) => l.product_id),
        );
      if (error) throw error;
      return data;
    },
  });
  const status = quoteStatus(q);
  const active = !["CONVERTED", "CANCELLED", "EXPIRED"].includes(status);
  const selected = q.items
    .filter((l) => quantities[l.product_id] > 0)
    .map((l) => ({ ...l, quantity: quantities[l.product_id] }));
  const sub = orderTotals(selected, 0, 0).subtotal;
  const discount = q.subtotal
    ? Math.round(((Number(q.discount) * sub) / Number(q.subtotal)) * 100) / 100
    : 0;
  const total = orderTotals(selected, discount, Number(q.tax_percent));
  const invalid =
    q.items.some(
      (l) =>
        !Number.isFinite(quantities[l.product_id]) ||
        quantities[l.product_id] < 0 ||
        quantities[l.product_id] > Number(l.quantity) ||
        Math.abs(
          quantities[l.product_id] * 1000 -
            Math.round(quantities[l.product_id] * 1000),
        ) > 0.000001,
    ) ||
    selected.some((l) => {
      const p = stock.data?.find((p) => p.id === l.product_id);
      return !p?.is_active || Number(p.quantity) < l.quantity;
    });
  const rows = q.items.map((l) => ({
    ...l,
    quote: q.reference,
    customer: q.customer_name,
    valid_until: q.valid_until,
    discount: q.discount,
    tax_percent: q.tax_percent,
    total: q.total,
    note: q.note ?? "",
  }));
  const columns = [
    { key: "quote", label: "Quotation" },
    { key: "customer", label: "Customer" },
    { key: "name", label: "Product" },
    { key: "quantity", label: "Quantity" },
    { key: "unit_price", label: "Unit price" },
    { key: "line_total", label: "Line total" },
    { key: "discount", label: "Quote discount" },
    { key: "tax_percent", label: "Tax %" },
    { key: "total", label: "Quote total" },
    { key: "valid_until", label: "Valid until" },
    { key: "note", label: "Notes" },
  ];
  if (edit)
    return (
      <QuoteEditor
        quote={q}
        saved={() => setEdit(false)}
        cancel={() => setEdit(false)}
      />
    );
  return (
    <section className="space-y-4 rounded-xl border border-primary/30 bg-surface p-5">
      <h2 className="font-semibold break-all">
        {q.reference} · {status}
      </h2>
      <p>
        {q.customer_name} · Valid until {q.valid_until}
      </p>
      <p className="text-sm text-muted-foreground">
        Quotation only. No payment is due until an invoice is issued.
      </p>
      <div className="space-y-2">
        {q.items.map((l) => (
          <p key={l.product_id}>
            {l.quantity} {l.unit} × {l.name} @ {money(l.unit_price, currency)} ={" "}
            {money(l.line_total, currency)}
          </p>
        ))}
      </div>
      <p>
        Discount {money(q.discount, currency)} · Tax{" "}
        {money(q.tax_amount, currency)} · Total{" "}
        <strong>{money(q.total, currency)}</strong>
      </p>
      {q.note && <p>{q.note}</p>}
      <ExportButton
        module="invoices"
        rows={rows}
        columns={columns}
        filename={`quotation-${q.reference}`}
      />
      <div className="flex flex-wrap gap-3">
        {q.status === "DRAFT" && active && (
          <Button variant="secondary" onClick={() => setEdit(true)}>
            Edit draft
          </Button>
        )}
        {active &&
          ["SENT", "ACCEPTED", "CANCELLED"]
            .filter(
              (s) =>
                s !== q.status && !(q.status === "ACCEPTED" && s === "SENT"),
            )
            .map((s) => (
              <Button
                key={s}
                variant="secondary"
                loading={busy}
                disabled={!online}
                onClick={() =>
                  run(
                    () =>
                      createClient().rpc("set_quote_status", {
                        p_quote: q.id,
                        p_status: s,
                        p_expected: q.version,
                      }),
                    "Quotation status updated",
                  )
                }
              >
                {s === "SENT"
                  ? "Mark as sent"
                  : s === "ACCEPTED"
                    ? "Mark as accepted"
                    : "Cancel quotation"}
              </Button>
            ))}
        {active && canModule("orders") && (
          <Button onClick={() => setConvert(!convert)}>
            Review conversion to order
          </Button>
        )}
        {q.order_id && (
          <Link href={`/orders?order=${q.order_id}`} className="text-accent">
            Open Orders — converted quotation
          </Link>
        )}
      </div>
      {convert && active && (
        <div className="space-y-3 rounded-lg border border-border p-4">
          <h3 className="font-semibold">Review quantities before conversion</h3>
          <p className="text-sm">
            Set quantity to zero to remove an item. Quoted unit prices and tax
            remain fixed; the discount is reduced proportionally. Stock is
            checked again when you convert and when goods are issued.
          </p>
          {q.items.map((l) => {
            const p = stock.data?.find((p) => p.id === l.product_id);
            return (
              <label
                className="flex flex-wrap items-center gap-3"
                key={l.product_id}
              >
                <span className="grow">
                  {l.name} · Available {p?.is_active ? p.quantity : 0} · Quoted{" "}
                  {l.quantity}
                </span>
                <Input
                  className="w-32"
                  type="number"
                  min="0"
                  max={Number(l.quantity)}
                  step="0.001"
                  value={quantities[l.product_id]}
                  onChange={(e) =>
                    setQuantities((old) => ({
                      ...old,
                      [l.product_id]: Number(e.target.value),
                    }))
                  }
                />
              </label>
            );
          })}
          {stock.error && (
            <p role="alert">
              Could not load stock.{" "}
              <Button onClick={() => stock.refetch()}>Retry</Button>
            </p>
          )}
          <p>
            Revised total: <strong>{money(total.total, currency)}</strong>. The
            original quotation is retained.
          </p>
          {invalid && (
            <p className="text-sm">
              Review unavailable items and quantities before continuing.
            </p>
          )}
          <Button
            loading={busy}
            disabled={
              !online ||
              stock.isFetching ||
              !!stock.error ||
              invalid ||
              !selected.length ||
              !total.valid
            }
            onClick={() =>
              run(
                () =>
                  createClient().rpc("convert_quote", {
                    p_quote: q.id,
                    p_items: selected.map((l) => ({
                      product_id: l.product_id,
                      quantity: l.quantity,
                    })),
                    p_expected: q.version,
                  }),
                "Quotation converted to draft order",
              )
            }
          >
            Confirm conversion
          </Button>
        </div>
      )}
      <PurchaseOrder quote={q.id} />
    </section>
  );
}
