import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { ToolbarSearch } from "@/components/shell/toolbar-search";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { money } from "@/lib/format";
import { Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { NewCustomerButton } from "@/features/credit/new-customer-button";
import { ListFilter } from "@/components/shell/list-filter";
import { Pagination } from "@/components/ui/pagination";
import { ExportButton } from "@/features/reports/export-button";

export default async function CreditPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    filter?: string;
    sort?: string;
    page?: string;
  }>;
}) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session?.activeStore) redirect("/onboarding");
  const store = session.activeStore;
  const supabase = await createClient();

  const page = Math.max(1, Math.floor(Number(sp.page) || 1)),
    pageSize = 50;
  const sort = ["name", "balance_asc", "status"].includes(sp.sort ?? "")
    ? sp.sort!
    : "balance_desc";
  let query = supabase
    .from("v_credit_customers")
    .select("*", { count: "exact" })
    .eq("store_id", store.id)
    .eq("is_active", sp.filter !== "inactive");
  if (sp.q) query = query.ilike("name", `%${sp.q}%`);
  if (sp.filter === "over") query = query.eq("over_limit", true);
  else if (sp.filter === "owing") query = query.gt("balance", 0);
  else if (sp.filter === "clear") query = query.lte("balance", 0);
  if (sort === "name") query = query.order("name");
  else if (sort === "status")
    query = query
      .order("over_limit", { ascending: false })
      .order("balance", { ascending: false });
  else query = query.order("balance", { ascending: sort === "balance_asc" });
  const { data, count, error } = await query
    .order("customer_id")
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw error;
  const rows = data ?? [];

  const totalOwed = rows.reduce(
    (s, r) => s + Math.max(Number(r.balance), 0),
    0,
  );
  const overCount = rows.filter((r) => r.over_limit).length;

  return (
    <>
      <PageHeader
        title="Credit Customers"
        crumbs={[{ label: "Operations" }, { label: "Credit" }]}
        actions={
          <>
            <ToolbarSearch placeholder="Search customers…" />
            <NewCustomerButton />
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted">Outstanding shown</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {money(totalOwed, store.currency)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted">Customers owing</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {rows.filter((r) => Number(r.balance) > 0).length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted">Over limit</p>
            <p
              className={cn(
                "mt-1 text-xl font-semibold tabular-nums",
                overCount > 0 && "text-danger",
              )}
            >
              {overCount}
            </p>
          </CardContent>
        </Card>
      </div>

      <p className="mb-3 text-xs text-muted">
        Totals cover the {rows.length} customers on this page. {count ?? 0}{" "}
        customers match your filters.
      </p>
      <div className="mb-4 flex flex-wrap gap-2">
        {[
          { k: "all", l: "All active" },
          { k: "owing", l: "Owing" },
          { k: "over", l: "Over limit" },
          { k: "clear", l: "Clear / in credit" },
          { k: "inactive", l: "Inactive" },
        ].map((f) => {
          const params = new URLSearchParams();
          if (sp.q) params.set("q", sp.q);
          params.set("sort", sort);
          if (f.k !== "all") params.set("filter", f.k);
          const active = (sp.filter ?? "all") === f.k;
          return (
            <Link
              key={f.k}
              href={`/credit?${params.toString()}`}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium",
                active
                  ? "border-primary/50 bg-primary/15 text-primary-hover"
                  : "border-border text-muted hover:bg-surface-2",
              )}
            >
              {f.l}
            </Link>
          );
        })}
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <ListFilter
          label="Sort"
          param="sort"
          value={sort}
          options={[
            { value: "balance_desc", label: "Highest balance" },
            { value: "balance_asc", label: "Lowest balance" },
            { value: "name", label: "Customer name" },
            { value: "status", label: "Status, then balance" },
          ]}
        />
        <ExportButton
          filename="credit-customers"
          rows={rows.map((r) => ({
            name: r.name,
            phone: r.phone,
            balance: Number(r.balance),
            credit_limit: Number(r.credit_limit),
            status: !r.is_active
              ? "Inactive"
              : r.over_limit
                ? "Over limit"
                : Number(r.balance) > 0
                  ? "Owing"
                  : "Clear / in credit",
          }))}
          columns={[
            { key: "name", label: "Customer" },
            { key: "phone", label: "Phone" },
            { key: "balance", label: "Balance" },
            { key: "credit_limit", label: "Limit" },
            { key: "status", label: "Status" },
          ]}
        />
      </div>

      <div className="rounded-lg border border-border bg-surface">
        {rows.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No credit customers"
            description="Add a customer to start tracking what they owe."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Customer</TH>
                <TH>Phone</TH>
                <TH className="text-right">Balance</TH>
                <TH className="text-right">Limit</TH>
                <TH className="text-right">Available</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.customer_id}>
                  <TD className="font-medium">
                    <Link
                      href={`/credit/${r.customer_id}`}
                      className="hover:text-primary-hover"
                    >
                      {r.name}
                    </Link>
                  </TD>
                  <TD className="text-muted">{r.phone ?? "—"}</TD>
                  <TD
                    className={cn(
                      "text-right tabular-nums",
                      Number(r.balance) > 0
                        ? "text-warning"
                        : "text-muted-foreground",
                    )}
                  >
                    {money(r.balance, store.currency)}
                  </TD>
                  <TD className="text-right tabular-nums text-muted-foreground">
                    {Number(r.credit_limit) > 0
                      ? money(r.credit_limit, store.currency)
                      : "—"}
                  </TD>
                  <TD className="text-right tabular-nums">
                    {money(r.available_credit, store.currency)}
                  </TD>
                  <TD>
                    {!r.is_active ? (
                      <Badge variant="neutral">Inactive</Badge>
                    ) : r.over_limit ? (
                      <Badge variant="danger">Over limit</Badge>
                    ) : Number(r.balance) > 0 ? (
                      <Badge variant="warning">Owing</Badge>
                    ) : (
                      <Badge variant="success">Clear</Badge>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>
      <Pagination
        page={page}
        pageSize={pageSize}
        total={count ?? 0}
        params={{ q: sp.q, filter: sp.filter, sort }}
        basePath="/credit"
      />
    </>
  );
}
