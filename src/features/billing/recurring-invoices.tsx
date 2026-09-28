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
import { useBillingAction } from "./use-billing-action";
import { businessDate } from "@/lib/business-date";
import { money, dateOnly } from "@/lib/format";
import type {
  RecurringInvoice,
  ProductStock,
  Json,
} from "@/lib/db/database.types";
type Line = {
  product_id: string;
  name: string;
  quantity: number;
  unit_price: number;
};
const selectClass =
  "h-10 w-full rounded-md border border-border bg-input px-3 text-sm";
export function RecurringInvoices() {
  const { store } = useStore(),
    action = useBillingAction();
  const [page, setPage] = useState(0),
    [filter, setFilter] = useState("all"),
    [editing, setEditing] = useState<RecurringInvoice | "new" | null>(null),
    [history, setHistory] = useState<string | null>(null);
  const rows = useQuery({
    queryKey: ["billing", "recurring", store.id, page, filter],
    queryFn: async () => {
      let q = createClient()
        .from("recurring_invoices")
        .select("*")
        .eq("store_id", store.id);
      if (filter !== "all") q = q.eq("active", filter === "active");
      const { data, error } = await q
        .order("created_at", { ascending: false })
        .order("id")
        .range(page * 20, page * 20 + 20);
      if (error) throw error;
      return data ?? [];
    },
  });
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-3">
        <Button disabled={!action.online} onClick={() => setEditing("new")}>
          Create recurring invoice
        </Button>
        <label>
          Show
          <select
            className={selectClass}
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setPage(0);
            }}
          >
            <option value="all">All schedules</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
      </div>
      {editing && (
        <RecurringEditor
          key={editing === "new" ? "new" : editing.id}
          initial={editing === "new" ? undefined : editing}
          close={() => setEditing(null)}
        />
      )}
      {rows.isLoading && <p role="status">Loading schedules...</p>}
      {rows.error && (
        <p role="alert">
          Could not load schedules.{" "}
          <Button onClick={() => rows.refetch()}>Retry</Button>
        </p>
      )}
      {rows.data?.length === 0 && <p>No recurring invoices yet.</p>}
      {rows.data?.slice(0, 20).map((r) => (
        <section
          key={r.id}
          className="space-y-3 rounded-xl border border-border bg-surface p-5"
        >
          <h2 className="font-semibold">{r.title}</h2>
          <p className="text-sm">
            {r.active ? "Active" : "Inactive"} · {r.frequency.toLowerCase()} ·
            Next: {dateOnly(r.next_date)} ·{" "}
            {r.auto_email
              ? `Automatic email to ${r.recipient}`
              : "Review and email manually"}
          </p>
          {r.last_error && (
            <p role="alert" className="text-danger">
              Generation needs attention:{" "}
              {r.last_error.replaceAll("_", " ").toLowerCase()}. Update the
              schedule or customer, then save to retry.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!action.online || action.busy}
              onClick={() => setEditing(r)}
            >
              Edit
            </Button>
            <Button
              disabled={!action.online || action.busy}
              onClick={() =>
                action.run(
                  () =>
                    createClient().rpc("set_recurring_active", {
                      p_id: r.id,
                      p_expected: r.version,
                      p_active: !r.active,
                    }),
                  r.active ? "Schedule deactivated" : "Schedule activated",
                )
              }
            >
              {r.active ? "Deactivate" : "Activate"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setHistory(history === r.id ? null : r.id)}
            >
              Generated invoices
            </Button>
          </div>
          {history === r.id && <RecurringHistory id={r.id} />}
        </section>
      ))}
      <div className="flex items-center gap-3">
        <Button
          disabled={!page || rows.isFetching}
          onClick={() => setPage(page - 1)}
        >
          Previous
        </Button>
        <span>Page {page + 1}</span>
        <Button
          disabled={(rows.data?.length ?? 0) <= 20 || rows.isFetching}
          onClick={() => setPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
function RecurringHistory({ id }: { id: string }) {
  const { store } = useStore();
  const [page, setPage] = useState(0);
  const query = useQuery({
    queryKey: ["billing", "recurring-history", store.id, id, page],
    queryFn: async () => {
      const db = createClient();
      const { data, error } = await db
        .from("sales_invoices")
        .select("id,reference,billing_period,total,currency,state")
        .eq("store_id", store.id)
        .eq("recurring_schedule_id", id)
        .order("billing_period", { ascending: false })
        .order("id")
        .range(page * 20, page * 20 + 20);
      if (error) throw error;
      const ids = (data ?? []).map((i) => i.id);
      const mail = ids.length
        ? await db
            .from("recurring_invoice_deliveries")
            .select("invoice_id,state,last_error")
            .in("invoice_id", ids)
        : { data: [], error: null };
      if (mail.error) throw mail.error;
      return { invoices: data ?? [], deliveries: mail.data ?? [] };
    },
  });
  return (
    <div>
      {query.isLoading ? (
        <p>Loading invoices...</p>
      ) : query.error ? (
        <p role="alert">
          Could not load invoice history.{" "}
          <Button onClick={() => query.refetch()}>Retry</Button>
        </p>
      ) : (
        <>
          <ul className="divide-y divide-border">
            {query.data?.invoices.slice(0, 20).map((i) => (
              <li key={i.id} className="py-2">
                <Link className="text-accent" href={`/invoices/${i.id}`}>
                  {i.reference}
                </Link>{" "}
                · {dateOnly(i.billing_period)} · {money(i.total, i.currency)} ·{" "}
                {i.state}
                <p className="text-xs text-muted">
                  Email:{" "}
                  {query.data.deliveries.find((d) => d.invoice_id === i.id)
                    ?.state ?? "Manual review"}
                </p>
                {query.data.deliveries.find((d) => d.invoice_id === i.id)
                  ?.last_error && (
                  <p className="text-warning">
                    {
                      query.data.deliveries.find((d) => d.invoice_id === i.id)
                        ?.last_error
                    }
                  </p>
                )}
              </li>
            ))}
          </ul>
          {query.data?.invoices.length === 0 && (
            <p>No invoices generated yet.</p>
          )}
          <Button disabled={page === 0} onClick={() => setPage(page - 1)}>
            Previous invoices
          </Button>
          <Button
            disabled={(query.data?.invoices.length ?? 0) <= 20}
            onClick={() => setPage(page + 1)}
          >
            Next invoices
          </Button>
        </>
      )}
    </div>
  );
}
function RecurringEditor({
  initial,
  close,
}: {
  initial?: RecurringInvoice;
  close: () => void;
}) {
  const { store, currency } = useStore(),
    action = useBillingAction();
  const [id] = useState(() => initial?.id ?? crypto.randomUUID());
  const [draft, setDraft] = useState(() => ({
    title: initial?.title ?? "",
    customer_id: initial?.customer_id ?? "",
    frequency: initial?.frequency ?? "MONTHLY",
    start_date: initial?.start_date ?? businessDate(),
    next_date: initial?.next_date ?? businessDate(),
    end_date: initial?.end_date ?? "",
    due_days: initial?.due_days ?? 30,
    terms: initial?.terms ?? "CREDIT",
    tax_percent: initial?.tax_percent ?? 0,
    recipient: initial?.recipient ?? "",
    active: initial?.active ?? false,
    auto_email: initial?.auto_email ?? false,
  }));
  const [pick, setPick] = useState(false),
    [customerName, setCustomerName] = useState(""),
    [product, setProduct] = useState<ProductStock | null>(null),
    [lines, setLines] = useState<Line[]>((initial?.items ?? []) as Line[]);
  const contact = useQuery({
    queryKey: ["billing", "recurring-customer", draft.customer_id],
    enabled: !!draft.customer_id,
    queryFn: async () => {
      const { data, error } = await createClient()
        .from("customers")
        .select("name,email,credit_enabled")
        .eq("id", draft.customer_id)
        .eq("store_id", store.id)
        .single();
      if (error) throw error;
      return data;
    },
  });
  const settings = useQuery({
    queryKey: ["billing", "recurring-tax", store.businessId],
    queryFn: async () => {
      const { data, error } = await createClient()
        .from("billing_settings")
        .select("tax_percent")
        .eq("business_id", store.businessId)
        .maybeSingle();
      if (error) throw error;
      return data?.tax_percent ?? 0;
    },
  });
  const subtotal = lines.reduce(
      (n, l) => n + Math.round(l.quantity * l.unit_price * 100) / 100,
      0,
    ),
    total = subtotal + Math.round(subtotal * draft.tax_percent) / 100;
  return (
    <form
      className="space-y-4 rounded-xl border border-primary/40 bg-surface p-5"
      onSubmit={(e) => {
        e.preventDefault();
        void action.run(
          () =>
            createClient().rpc("save_recurring_invoice", {
              p_store: store.id,
              p_id: id,
              p_expected: initial?.version ?? 0,
              p_details: { ...draft, items: lines } as Json,
            }),
          "Recurring invoice saved",
          close,
        );
      }}
    >
      <h2 className="text-lg font-semibold">
        {initial ? "Edit recurring invoice" : "New recurring invoice"}
      </h2>
      <fieldset disabled={action.busy || !action.online} className="space-y-4">
        <label className="block text-sm">
          Schedule name
          <Input
            required
            maxLength={120}
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
        </label>
        <div className="flex items-center gap-3">
          <Button type="button" onClick={() => setPick(true)}>
            Select customer
          </Button>
          <span>
            {contact.data?.name || customerName || "Choose a customer"}
          </span>
        </div>
        {contact.error && <p role="alert">Could not load customer details.</p>}
        <CustomerPicker
          open={pick}
          onOpenChange={setPick}
          onSelect={(c) => {
            setCustomerName(c.name);
            setDraft({
              ...draft,
              customer_id: c.customer_id,
              recipient: c.email ?? "",
              terms: c.credit_enabled === false ? "CASH" : draft.terms,
            });
          }}
        />
        <LocationProductPicker
          searchable
          location={store.id}
          label="Products / services"
          onChange={setProduct}
          value={product}
          itemType="Individual"
        />
        <Button
          type="button"
          disabled={!product || lines.some((l) => l.product_id === product.id)}
          onClick={() => {
            if (product) {
              setLines([
                ...lines,
                {
                  product_id: product.id,
                  name: product.name,
                  quantity: 1,
                  unit_price: product.selling_price,
                },
              ]);
              setProduct(null);
            }
          }}
        >
          Add product / service
        </Button>
        <p className="text-xs text-muted">
          For services, select a sales-only product. Prices below are saved for
          future billing; later catalogue price changes do not alter this
          schedule.
        </p>
        {lines.map((l, index) => (
          <div
            key={l.product_id}
            className="grid items-end gap-3 sm:grid-cols-4"
          >
            <span>{l.name}</span>
            <label className="text-sm">
              Quantity
              <Input
                required
                type="number"
                min="0.001"
                max="999999999"
                step="0.001"
                value={l.quantity}
                onChange={(e) =>
                  setLines(
                    lines.map((x, k) =>
                      k === index
                        ? { ...x, quantity: Number(e.target.value) }
                        : x,
                    ),
                  )
                }
              />
            </label>
            <label className="text-sm">
              Unit price
              <Input
                required
                type="number"
                min="0"
                max="999999999"
                step="0.01"
                value={l.unit_price}
                onChange={(e) =>
                  setLines(
                    lines.map((x, k) =>
                      k === index
                        ? { ...x, unit_price: Number(e.target.value) }
                        : x,
                    ),
                  )
                }
              />
            </label>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setLines(lines.filter((_, k) => k !== index))}
            >
              Remove {l.name}
            </Button>
          </div>
        ))}
        <div className="grid gap-3 sm:grid-cols-3">
          <label>
            Frequency
            <select
              className={selectClass}
              value={draft.frequency}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  frequency: e.target.value as RecurringInvoice["frequency"],
                })
              }
            >
              <option value="MONTHLY">Monthly</option>
              <option value="WEEKLY">Weekly</option>
              <option value="DAILY">Daily</option>
            </select>
          </label>
          {(
            [
              ["start_date", "Start date"],
              ["next_date", "Next invoice date"],
              ["end_date", "End date (optional)"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              <Input
                type="date"
                required={key !== "end_date"}
                value={draft[key]}
                onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
              />
            </label>
          ))}
          <label>
            Payment due after (days)
            <Input
              type="number"
              required
              min="0"
              max="365"
              value={draft.due_days}
              onChange={(e) =>
                setDraft({ ...draft, due_days: Number(e.target.value) })
              }
            />
          </label>
          <label>
            Payment terms
            <select
              className={selectClass}
              value={draft.terms}
              onChange={(e) => setDraft({ ...draft, terms: e.target.value })}
            >
              <option value="CREDIT">Credit</option>
              <option value="CASH">Cash before goods issue</option>
              <option value="CARD_EFT">Card / EFT before goods issue</option>
            </select>
          </label>
          <label>
            Tax / VAT (%)
            <Input
              type="number"
              min="0"
              max="100"
              step="0.01"
              required
              value={draft.tax_percent}
              onChange={(e) =>
                setDraft({ ...draft, tax_percent: Number(e.target.value) })
              }
            />
          </label>
          <Button
            type="button"
            variant="secondary"
            disabled={settings.data === undefined}
            onClick={() =>
              setDraft({ ...draft, tax_percent: settings.data ?? 0 })
            }
          >
            Use business tax ({settings.data ?? 0}%)
          </Button>
        </div>
        <p className="text-sm">
          Invoice total: <strong>{money(total, currency)}</strong>
        </p>
        <label className="block text-sm">
          Invoice email recipient
          <Input
            type="email"
            required={draft.auto_email}
            maxLength={254}
            value={draft.recipient}
            onChange={(e) => setDraft({ ...draft, recipient: e.target.value })}
          />
        </label>
        <label className="flex gap-2">
          <input
            type="checkbox"
            checked={draft.auto_email}
            onChange={(e) =>
              setDraft({ ...draft, auto_email: e.target.checked })
            }
          />
          Automatically email each generated invoice to this recipient
        </label>
        <label className="flex gap-2">
          <input
            type="checkbox"
            checked={draft.active}
            onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
          />
          Activate schedule
        </label>
        <p className="text-xs text-muted">
          Active schedules generate issued invoices and customer balances when
          due. Physical stock is deducted only through Issue goods. Monthly
          schedules use the start-date day, or the last day of a shorter month.
          Past dates catch up one billing period per scheduled run. Credit
          limits and current permissions are checked every run.
        </p>
        {draft.terms === "CREDIT" && contact.data?.credit_enabled === false && (
          <p role="alert" className="text-danger">
            Enable customer credit or choose cash/card terms.
          </p>
        )}
        <div className="flex gap-3">
          <Button
            type="submit"
            loading={action.busy}
            disabled={
              !draft.customer_id ||
              !lines.length ||
              (draft.terms === "CREDIT" &&
                contact.data?.credit_enabled === false)
            }
          >
            Save recurring invoice
          </Button>
          <Button type="button" variant="secondary" onClick={close}>
            Cancel
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
