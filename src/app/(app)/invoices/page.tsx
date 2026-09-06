import { businessDayStart, businessDayAfter } from "@/lib/business-date";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { ExportButton } from "@/features/reports/export-button";
import { money, dateOnly } from "@/lib/format";
import { InvoiceSummary } from "@/features/billing/invoice-summary";
export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    sort?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session?.activeStore) redirect("/onboarding");
  const store = session.activeStore;
  const db = await createClient();
  let query = db
    .from("v_invoice_balances")
    .select("*")
    .eq("store_id", store.id);
  if (sp.q) query = query.ilike("customer_name", `%${sp.q}%`);
  if (sp.status) query = query.eq("status", sp.status);
  if (sp.from) query = query.gte("created_at", businessDayStart(sp.from));
  if (sp.to) query = query.lt("created_at", businessDayAfter(sp.to));
  const { data, error } = await query
    .order(
      sp.sort === "due"
        ? "due_date"
        : sp.sort === "balance"
          ? "outstanding"
          : "created_at",
      { ascending: sp.sort === "due" },
    )
    .limit(500);
  if (error) throw error;
  const rows = data ?? [];
  return (
    <>
      <PageHeader
        title="Invoices"
        description="Track issued invoices, payments, credit notes and balances by customer."
        crumbs={[{ label: "Sales" }, { label: "Invoices" }]}
        actions={
          <Link className="text-accent" href="/orders">
            Create from order
          </Link>
        }
      />
      <InvoiceSummary storeId={store.id} currency={store.currency} />
      <form className="mb-5 flex flex-wrap gap-3">
        <input
          className="rounded border border-border bg-input px-3 py-2"
          name="q"
          aria-label="Customer name"
          placeholder="Customer name"
          defaultValue={sp.q}
        />
        <select
          className="rounded border border-border bg-input px-3 py-2"
          name="status"
          aria-label="Invoice status"
          defaultValue={sp.status ?? ""}
        >
          <option value="">All statuses</option>
          {[
            "DRAFT",
            "UNPAID",
            "PARTIALLY_PAID",
            "PAID",
            "OVERDUE",
            "CREDITED",
            "CANCELLED",
            "VOID",
          ].map((s) => (
            <option key={s} value={s}>
              {s.replaceAll("_", " ")}
            </option>
          ))}
        </select>
        <select
          name="sort"
          aria-label="Invoice sort"
          defaultValue={sp.sort ?? "newest"}
          className="rounded border border-border bg-input px-3"
        >
          <option value="newest">Newest first</option>
          <option value="due">Due date</option>
          <option value="balance">Largest balance</option>
        </select>
        <input
          type="date"
          name="from"
          aria-label="From date"
          defaultValue={sp.from}
          className="rounded border border-border bg-input px-2"
        />
        <input
          type="date"
          name="to"
          aria-label="To date"
          defaultValue={sp.to}
          className="rounded border border-border bg-input px-2"
        />
        <button className="rounded bg-primary px-4 py-2">Apply filters</button>
      </form>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {rows.length} invoices shown
          {rows.length === 500 ? " — latest 500; narrow your filters" : ""}.
          Outstanding in these results:{" "}
          {money(
            rows.reduce((n, r) => n + Math.max(Number(r.outstanding), 0), 0),
            store.currency,
          )}
        </p>
        <ExportButton
          rows={rows.map((r) => ({
            reference: r.reference,
            customer: r.customer_name,
            status: r.status,
            due: r.due_date,
            total: r.total,
            paid: r.paid,
            credits: r.credits,
            debits: r.debits,
            outstanding: r.outstanding,
          }))}
          columns={[
            { key: "reference", label: "Invoice" },
            { key: "customer", label: "Customer" },
            { key: "status", label: "Status" },
            { key: "due", label: "Due" },
            { key: "total", label: "Total" },
            { key: "paid", label: "Payments" },
            { key: "credits", label: "Credit notes" },
            { key: "debits", label: "Debit notes" },
            { key: "outstanding", label: "Outstanding" },
          ]}
          filename="invoices"
        />
      </div>
      <Table>
        <THead>
          <TR>
            <TH>Invoice</TH>
            <TH>Customer</TH>
            <TH>Status</TH>
            <TH>Due</TH>
            <TH>Total</TH>
            <TH>Outstanding</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((i) => (
            <TR key={i.id}>
              <TD>
                <Link className="text-accent" href={`/invoices/${i.id}`}>
                  {i.reference}
                </Link>
              </TD>
              <TD>{i.customer_name}</TD>
              <TD>{i.status.replaceAll("_", " ")}</TD>
              <TD>{dateOnly(i.due_date)}</TD>
              <TD>{money(i.total, store.currency)}</TD>
              <TD>{money(i.outstanding, store.currency)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}
