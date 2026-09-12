import { businessDayStart, businessDayAfter } from "@/lib/business-date";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { DateFilter } from "@/features/reports/date-filter";
import { ExportButton } from "@/features/reports/export-button";
import { money, dateTime } from "@/lib/format";
import { PackageMinus } from "lucide-react";

export default async function GoodsOutReport({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const session = await getSession("reports");
  if (!session?.activeStore) redirect("/onboarding");
  const store = session.activeStore;
  const supabase = await createClient();

  let query = supabase
    .from("goods_out")
    .select(
      "id, sale_type, total_amount, credit_override, performed_by, authorized_by, created_at, customers(name), goods_out_items(id)",
    )
    .eq("store_id", store.id);
  if (sp.from) query = query.gte("created_at", businessDayStart(sp.from));
  if (sp.to) query = query.lt("created_at", businessDayAfter(sp.to));
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  const rows = (data ?? []) as unknown as {
    id: string;
    sale_type: string;
    total_amount: number;
    credit_override: boolean;
    performed_by: string;
    authorized_by: string | null;
    created_at: string;
    customers: { name: string } | null;
    goods_out_items: { id: string }[];
  }[];

  const userIds = [
    ...new Set(
      rows.flatMap((r) =>
        [r.performed_by, r.authorized_by].filter((id): id is string => !!id),
      ),
    ),
  ];
  const { data: people, error: peopleError } = userIds.length
    ? await supabase.from("profiles").select("id,full_name").in("id", userIds)
    : { data: [], error: null };
  if (peopleError) throw peopleError;
  const names = new Map((people ?? []).map((p) => [p.id, p.full_name]));
  const { data: receiptRows, error: receiptError } = rows.length
    ? await supabase
        .from("sale_receipts")
        .select("sale_id,snapshot")
        .eq("store_id", store.id)
        .in(
          "sale_id",
          rows.map((r) => r.id),
        )
    : { data: [], error: null };
  if (receiptError) throw receiptError;
  const receipts = new Map(
    (receiptRows ?? []).map((r) => [
      r.sale_id,
      r.snapshot as import("@/features/goods-out/payments").SaleReceipt,
    ]),
  );
  const paymentType = (r: (typeof rows)[number]) =>
    receipts
      .get(r.id)
      ?.payments.map((p) => p.method)
      .join(" + ") || r.sale_type;
  const paymentAmount = (
    r: (typeof rows)[number],
    methods: string[],
    legacy: string,
  ) => {
    const receipt = receipts.get(r.id);
    return receipt
      ? receipt.payments
          .filter((p) => methods.includes(p.method))
          .reduce((sum, p) => sum + Number(p.amount), 0)
      : r.sale_type === legacy
        ? Number(r.total_amount)
        : 0;
  };
  const salesperson = (r: (typeof rows)[number]) =>
    receipts.get(r.id)?.cashier ||
    names.get(r.performed_by) ||
    "User unavailable";
  const approver = (r: (typeof rows)[number]) =>
    r.credit_override
      ? r.authorized_by
        ? names.get(r.authorized_by) || "User unavailable"
        : "Not recorded"
      : "—";
  const cash = rows.reduce(
    (sum, r) => sum + paymentAmount(r, ["CASH"], "CASH"),
    0,
  );
  const credit = rows
    .filter((r) => r.sale_type === "CREDIT")
    .reduce((s, r) => s + Number(r.total_amount), 0);
  const card = rows.reduce(
    (sum, r) => sum + paymentAmount(r, ["CARD", "EFT"], "CARD_EFT"),
    0,
  );

  const exportRows = rows.map((r) => ({
    date: dateTime(r.created_at),
    type: paymentType(r),
    customer: r.customers?.name ?? "",
    items: r.goods_out_items?.length ?? 0,
    total: r.total_amount,
    override: r.credit_override ? "yes" : "",
    salesperson: salesperson(r),
    approved_by: approver(r),
  }));
  const columns = [
    { key: "date", label: "Date" },
    { key: "type", label: "Type" },
    { key: "customer", label: "Customer" },
    { key: "items", label: "Items" },
    { key: "total", label: "Total" },
    { key: "override", label: "Override" },
    { key: "salesperson", label: "Sold by" },
    { key: "approved_by", label: "Override approved by" },
  ];

  return (
    <>
      <PageHeader
        title="Goods Out"
        crumbs={[
          { label: "Reports", href: "/reports" },
          { label: "Goods Out" },
        ]}
        description="Checkout sales by payment type and customer; invoice transactions appear in Payment Report."
        actions={
          <>
            <DateFilter />
            <ExportButton
              rows={exportRows}
              columns={columns}
              filename="goods-out"
            />
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted">Cash sales</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-accent">
              {money(cash, store.currency)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted">Credit sales</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-primary-hover">
              {money(credit, store.currency)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted">Card/EFT sales</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {money(card, store.currency)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted">Total</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {money(cash + credit + card, store.currency)}
            </p>
          </CardContent>
        </Card>
      </div>
      <p className="mb-4 text-sm text-muted">
        {rows.length} records shown. Exports and totals cover these results.
        {rows.length === 500
          ? " Latest 500; narrow the dates for earlier records."
          : ""}
      </p>
      <div className="rounded-lg border border-border bg-surface">
        {rows.length === 0 ? (
          <EmptyState icon={PackageMinus} title="No sales in this range" />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Date</TH>
                <TH>Type</TH>
                <TH>Customer</TH>
                <TH>Sold by</TH>
                <TH>Override approved by</TH>
                <TH className="text-right">Items</TH>
                <TH className="text-right">Total</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD className="text-xs text-muted whitespace-nowrap">
                    {dateTime(r.created_at)}
                  </TD>
                  <TD>
                    <Badge
                      variant={r.sale_type === "CASH" ? "accent" : "primary"}
                    >
                      {paymentType(r)}
                    </Badge>
                    {r.credit_override ? (
                      <Badge variant="danger" className="ml-1">
                        Override
                      </Badge>
                    ) : null}
                  </TD>
                  <TD className="text-muted">{r.customers?.name ?? "—"}</TD>
                  <TD>{salesperson(r)}</TD>
                  <TD>{approver(r)}</TD>
                  <TD className="text-right tabular-nums">
                    {r.goods_out_items?.length ?? 0}
                  </TD>
                  <TD className="text-right tabular-nums font-medium">
                    {money(r.total_amount, store.currency)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </>
  );
}
