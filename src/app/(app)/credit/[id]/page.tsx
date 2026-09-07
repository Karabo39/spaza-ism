import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { CreditActions } from "@/features/credit/credit-actions";
import { money, dateTime } from "@/lib/format";
import { ScrollText } from "lucide-react";
import { cn } from "@/lib/utils";
import { ExportButton } from "@/features/reports/export-button";
import { DateFilter } from "@/features/reports/date-filter";
import { ListFilter } from "@/components/shell/list-filter";
import { Pagination } from "@/components/ui/pagination";
import { businessDayStart, businessDayAfter } from "@/lib/business-date";
import type { CreditTxnType } from "@/lib/db/database.types";

const TXN_LABEL: Record<string, string> = {
  CREDIT_SALE: "Credit sale",
  PAYMENT: "Payment",
  ADJUSTMENT: "Adjustment",
  OPENING_BALANCE: "Opening balance",
};

export default async function CustomerCreditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    from?: string;
    to?: string;
    type?: string;
    sort?: string;
    page?: string;
  }>;
}) {
  const { id } = await params;
  const sp = await searchParams,
    page = Math.max(1, Math.floor(Number(sp.page) || 1)),
    pageSize = 50;
  const session = await getSession("credit");
  if (!session?.activeStore) redirect("/onboarding");
  const store = session.activeStore;
  const supabase = await createClient();

  const { data: customer } = await supabase
    .from("v_credit_customers")
    .select("*")
    .eq("customer_id", id)
    .eq("store_id", store.id)
    .maybeSingle();
  if (!customer) notFound();

  let query = supabase
    .from("credit_transactions")
    .select("*", { count: "exact" })
    .eq("credit_account_id", customer.credit_account_id)
    .eq("store_id", store.id);
  if (sp.from) query = query.gte("created_at", businessDayStart(sp.from));
  if (sp.to) query = query.lt("created_at", businessDayAfter(sp.to));
  if (sp.type && Object.hasOwn(TXN_LABEL, sp.type))
    query = query.eq("txn_type", sp.type as CreditTxnType);
  const {
    data: statement,
    count,
    error,
  } = await query
    .order("created_at", { ascending: sp.sort !== "newest" })
    .order("id")
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw error;
  const rows = (statement ?? []) as {
    id: string;
    created_at: string;
    txn_type: string;
    amount: number;
    balance_after: number;
    note: string | null;
  }[];

  return (
    <>
      <PageHeader
        title={customer.name}
        crumbs={[
          { label: "Credit", href: "/credit" },
          { label: customer.name },
        ]}
        description={customer.phone ?? undefined}
        actions={
          <>
            <ExportButton
              rows={rows.map((t) => ({
                date: dateTime(t.created_at),
                type: TXN_LABEL[t.txn_type] ?? t.txn_type,
                amount: -Number(t.amount),
                balance: t.balance_after,
                note: t.note ?? "",
              }))}
              columns={[
                { key: "date", label: "Date" },
                { key: "type", label: "Type" },
                {
                  key: "amount",
                  label: "Amount (+ received / - credit taken)",
                },
                { key: "balance", label: "Outstanding" },
                { key: "note", label: "Note" },
              ]}
              filename="customer-statement"
            />
            <CreditActions
              customerId={customer.customer_id}
              balance={Number(customer.balance)}
              creditLimit={Number(customer.credit_limit)}
            />
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted">Outstanding balance</p>
            <p
              className={cn(
                "mt-1 text-xl font-semibold tabular-nums",
                Number(customer.balance) > 0 ? "text-warning" : "text-success",
              )}
            >
              {money(customer.balance, store.currency)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted">Credit limit</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {Number(customer.credit_limit) > 0
                ? money(customer.credit_limit, store.currency)
                : "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted">Available credit</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {money(customer.available_credit, store.currency)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted">Status</p>
            <p className="mt-1">
              {customer.over_limit ? (
                <Badge variant="danger">Over limit</Badge>
              ) : Number(customer.balance) > 0 ? (
                <Badge variant="warning">Owing</Badge>
              ) : (
                <Badge variant="success">Clear</Badge>
              )}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="rounded-lg border border-border bg-surface">
        <div className="flex flex-wrap gap-3 border-b border-border p-4">
          <DateFilter />
          <ListFilter
            label="Entry type"
            param="type"
            value={sp.type ?? ""}
            options={[
              { value: "", label: "All entries" },
              ...Object.entries(TXN_LABEL).map(([value, label]) => ({
                value,
                label,
              })),
            ]}
          />
          <ListFilter
            label="Order"
            param="sort"
            value={sp.sort ?? "oldest"}
            options={[
              { value: "oldest", label: "Oldest first" },
              { value: "newest", label: "Newest first" },
            ]}
          />
          <p className="w-full text-xs text-muted">
            {count ?? 0} matching entries. Export covers this page. Account
            totals above show the current balance; each entry retains its
            recorded balance.
          </p>
        </div>
        <div className="border-b border-border px-5 py-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <ScrollText className="size-4 text-muted" /> Statement
          </h3>
        </div>
        {rows.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="No transactions yet"
            description="Credit sales and payments will appear here."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Date</TH>
                <TH>Type</TH>
                <TH>Note</TH>
                <TH className="text-right">Amount</TH>
                <TH className="text-right">Balance</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((t) => {
                const positive = Number(t.amount) >= 0;
                return (
                  <TR key={t.id}>
                    <TD className="text-xs text-muted">
                      {dateTime(t.created_at)}
                    </TD>
                    <TD>
                      <Badge
                        variant={
                          t.txn_type === "PAYMENT" ? "success" : "primary"
                        }
                      >
                        {TXN_LABEL[t.txn_type] ?? t.txn_type}
                      </Badge>
                    </TD>
                    <TD className="text-muted">{t.note ?? "—"}</TD>
                    <TD
                      className={cn(
                        "text-right tabular-nums",
                        positive ? "text-warning" : "text-success",
                      )}
                    >
                      {positive ? "−" : "+"}
                      {money(Math.abs(Number(t.amount)), store.currency)}
                    </TD>
                    <TD className="text-right font-medium tabular-nums">
                      {money(t.balance_after, store.currency)}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </div>
      <Pagination
        basePath={`/credit/${id}`}
        page={page}
        pageSize={pageSize}
        total={count ?? 0}
        params={{ from: sp.from, to: sp.to, type: sp.type, sort: sp.sort }}
      />
    </>
  );
}
