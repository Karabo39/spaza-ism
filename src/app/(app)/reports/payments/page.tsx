import { businessDayStart, businessDayAfter } from "@/lib/business-date";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { DateFilter } from "@/features/reports/date-filter";
import { ExportButton } from "@/features/reports/export-button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { money, dateTime } from "@/lib/format";
export default async function PaymentReport({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session?.activeStore) redirect("/onboarding");
  const store = session.activeStore;
  const db = await createClient();
  let query = db
    .from("v_payment_activity")
    .select("*")
    .eq("store_id", store.id);
  if (sp.from) query = query.gte("created_at", businessDayStart(sp.from));
  if (sp.to) query = query.lt("created_at", businessDayAfter(sp.to));
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw error;
  const rows = (data ?? []).map((r) => ({
    id: r.id,
    reference: r.reference,
    date: dateTime(r.created_at),
    method: r.method,
    amount: Number(r.amount),
    slip: r.payment_reference ?? "",
    source: r.source,
  }));
  return (
    <>
      <PageHeader
        title="Payment Report"
        description="Reconcile checkout sales, invoice payments and refunds by payment method and reference."
        crumbs={[{ label: "Reports", href: "/reports" }, { label: "Payments" }]}
        actions={
          <>
            <DateFilter />
            <ExportButton
              rows={rows}
              columns={[
                { key: "reference", label: "Reference" },
                { key: "date", label: "Date" },
                { key: "source", label: "Activity" },
                { key: "method", label: "Method" },
                { key: "amount", label: "Amount" },
                { key: "slip", label: "Card/EFT reference" },
              ]}
              filename="payments"
            />
          </>
        }
      />
      {rows.length === 1000 && (
        <p className="mb-4 text-warning">
          Showing the latest 1,000 sales. Narrow the date range for a complete
          reconciliation.
        </p>
      )}
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        {["CASH", "CARD_EFT", "CREDIT"].map((method) => (
          <div
            key={method}
            className="rounded-lg border border-border bg-surface p-4"
          >
            <p className="text-sm text-muted">
              {method === "CREDIT"
                ? "Credit charged"
                : `${method.replace("_", "/")} net received`}
            </p>
            <p className="text-xl font-semibold">
              {money(
                rows
                  .filter(
                    (r) =>
                      r.method === method &&
                      !(method === "CREDIT" && r.source === "INVOICE_PAYMENT"),
                  )
                  .reduce((sum, r) => sum + r.amount, 0),
                store.currency,
              )}
            </p>
          </div>
        ))}
      </div>
      <p className="mb-3 text-sm text-muted">
        Cash and Card/EFT totals include refunds as negative amounts. Credit
        charged shows debt created; store-credit allocations are listed
        separately as invoice payments and excluded from that total.
      </p>
      <Table>
        <THead>
          <TR>
            <TH>Date</TH>
            <TH>Reference</TH>
            <TH>Activity</TH>
            <TH>Method</TH>
            <TH>Card/EFT reference</TH>
            <TH>Amount</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => (
            <TR key={`${r.source}:${r.id}`}>
              <TD>{r.date}</TD>
              <TD>{r.reference}</TD>
              <TD>{r.source.replaceAll("_", " ")}</TD>
              <TD>{r.method}</TD>
              <TD>{r.slip || "—"}</TD>
              <TD>{money(r.amount, store.currency)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}
