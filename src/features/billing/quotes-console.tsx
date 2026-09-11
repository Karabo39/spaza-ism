"use client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { QuoteEditor } from "./quote-editor";
import { statusLabel } from "./status-label";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ExportButton } from "@/features/reports/export-button";
import { useBillingAction } from "./use-billing-action";
import { PurchaseOrder } from "./purchase-order";
import { orderTotals } from "./order-totals";
import { businessDate } from "@/lib/business-date";
import { money } from "@/lib/format";
import type { SalesQuote } from "@/lib/db/database.types";

export function QuotesConsole() {
  const { store, currency, canModule } = useStore();
  const [selected, setSelected] = useState<string | null>(null);
  const params = useSearchParams();
  const [creating, setCreating] = useState(
    params.get("create") === "1" && canModule("invoices_create_quotes"),
  );
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const term = useDebouncedValue(search.trim());
  const query = useQuery({
    queryKey: ["billing", "quotes", store.id, term, page],
    enabled: canModule("invoices_view_quotes"),
    queryFn: async () => {
      const { data, error } = await createClient()
        .from("sales_quotes")
        .select(
          "id,business_id,store_id,customer_id,customer_name,reference,status,valid_until,items,subtotal,discount,tax_percent,tax_amount,total,note,version,created_by,created_at,order_id",
        )
        .eq("store_id", store.id)
        .ilike("customer_name", `%${term}%`)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(page * 50, page * 50 + 49);
      if (error) throw error;
      return data;
    },
  });
  const current = query.data?.find((q) => q.id === selected);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-3">
        {canModule("invoices_create_quotes") && (
          <Button
            onClick={() => {
              setSelected(null);
              setCreating(true);
            }}
          >
            Create Quotes
          </Button>
        )}
        {canModule("invoices_view_quotes") && (
          <Input
            aria-label="Search quotations by customer"
            placeholder="Search customer"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        )}
      </div>
      {creating && canModule("invoices_create_quotes") ? (
        <QuoteEditor
          key={`new:${store.id}`}
          saved={(id) => {
            setSearch("");
            setPage(0);
            setSelected(id);
            setCreating(false);
          }}
          cancel={() => setCreating(false)}
        />
      ) : current && canModule("invoices_view_quotes") ? (
        <QuoteDetail key={`${current.id}:${current.version}`} quote={current} />
      ) : null}
      {canModule("invoices_view_quotes") && (
        <>
          <h2 className="font-semibold">Saved quotes</h2>
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
                  className="min-w-0 break-words rounded-lg border border-border bg-surface p-4 text-left hover:border-primary"
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
                    {statusLabel(quoteStatus(q))} · Valid until {q.valid_until}
                  </p>
                </button>
              ))}
            </div>
          )}
          {query.data?.length === 0 && <p>No quotations found.</p>}
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              disabled={page === 0 || query.isFetching}
              onClick={() => setPage(page - 1)}
            >
              Previous quotes
            </Button>
            <span>Page {page + 1}</span>
            <Button
              variant="secondary"
              disabled={query.isFetching || (query.data?.length ?? 0) < 50}
              onClick={() => setPage(page + 1)}
            >
              Next quotes
            </Button>
          </div>
        </>
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
function QuoteDetail({ quote: q }: { quote: SalesQuote }) {
  const { store, currency, canModule } = useStore();
  const { online, busy, run } = useBillingAction();
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [addPo, setAddPo] = useState(false);
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
  if (edit && canModule("invoices_create_quotes"))
    return (
      <QuoteEditor
        quote={q}
        saved={() => setEdit(false)}
        cancel={() => setEdit(false)}
      />
    );
  return (
    <section className="min-w-0 break-words space-y-4 rounded-xl border border-primary/30 bg-surface p-5">
      <h2 className="font-semibold break-all">
        {q.reference} · {statusLabel(status)}
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
        {q.status === "DRAFT" &&
          active &&
          canModule("invoices_create_quotes") && (
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
                  s === "ACCEPTED"
                    ? setAcceptOpen(true)
                    : run(
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
        {active && canModule("orders_new") && (
          <Button
            onClick={() =>
              q.status === "ACCEPTED"
                ? setConvert(!convert)
                : setAcceptOpen(true)
            }
          >
            Review conversion to order
          </Button>
        )}
        {q.order_id && canModule("orders_recent") && (
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
      <Dialog open={acceptOpen} onOpenChange={setAcceptOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Accept quote</DialogTitle>
          </DialogHeader>
          <p className="text-sm">
            Would you like to add the customer purchase order before accepting?
            After acceptance, its details will be locked.
          </p>
          {addPo ? (
            <PurchaseOrder
              quote={q.id}
              saved={() => {
                void run(
                  () =>
                    createClient().rpc("set_quote_status", {
                      p_quote: q.id,
                      p_status: "ACCEPTED",
                      p_expected: q.version,
                    }),
                  "Quote accepted",
                  () => setAcceptOpen(false),
                );
              }}
            />
          ) : (
            <div className="flex flex-wrap gap-3">
              <Button variant="secondary" onClick={() => setAddPo(true)}>
                Add purchase order
              </Button>
              <Button
                loading={busy}
                disabled={!online}
                onClick={() =>
                  run(
                    () =>
                      createClient().rpc("set_quote_status", {
                        p_quote: q.id,
                        p_status: "ACCEPTED",
                        p_expected: q.version,
                      }),
                    "Quote accepted",
                    () => setAcceptOpen(false),
                  )
                }
              >
                Accept without adding PO
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
