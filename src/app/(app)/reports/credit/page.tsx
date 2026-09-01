import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { ExportButton } from "@/features/reports/export-button";
import { money } from "@/lib/format";
import { Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

export default async function CreditBalancesReport() {
  const session = await getSession();
  if (!session?.activeStore) redirect("/onboarding");
  const store = session.activeStore;
  const supabase = await createClient();

  const { data } = await supabase.from("v_credit_customers").select("*").eq("store_id", store.id).order("balance", { ascending: false });
  const rows = data ?? [];
  const total = rows.reduce((s, r) => s + Math.max(Number(r.balance), 0), 0);

  const exportRows = rows.map((r) => ({ name: r.name, phone: r.phone ?? "", balance: r.balance, limit: r.credit_limit, available: r.available_credit, status: r.over_limit ? "over limit" : Number(r.balance) > 0 ? "owing" : "clear" }));
  const columns = [{ key: "name", label: "Customer" }, { key: "phone", label: "Phone" }, { key: "balance", label: "Balance" }, { key: "limit", label: "Limit" }, { key: "available", label: "Available" }, { key: "status", label: "Status" }];

  return (
    <>
      <PageHeader title="Customer Credit Balances" crumbs={[{ label: "Reports", href: "/reports" }, { label: "Credit Balances" }]}
        description={`Total outstanding: ${money(total, store.currency)}`}
        actions={<ExportButton rows={exportRows} columns={columns} filename="credit-balances" />} />
      <div className="rounded-lg border border-border bg-surface">
        {rows.length === 0 ? <EmptyState icon={Wallet} title="No credit customers" /> : (
          <Table>
            <THead><TR><TH>Customer</TH><TH>Phone</TH><TH className="text-right">Balance</TH><TH className="text-right">Limit</TH><TH className="text-right">Available</TH><TH>Status</TH></TR></THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.customer_id}>
                  <TD className="font-medium"><Link href={`/credit/${r.customer_id}`} className="hover:text-primary-hover">{r.name}</Link></TD>
                  <TD className="text-muted">{r.phone ?? "—"}</TD>
                  <TD className={cn("text-right tabular-nums", Number(r.balance) > 0 ? "text-warning" : "text-muted-foreground")}>{money(r.balance, store.currency)}</TD>
                  <TD className="text-right tabular-nums text-muted-foreground">{Number(r.credit_limit) > 0 ? money(r.credit_limit, store.currency) : "—"}</TD>
                  <TD className="text-right tabular-nums">{money(r.available_credit, store.currency)}</TD>
                  <TD>{r.over_limit ? <Badge variant="danger">Over limit</Badge> : Number(r.balance) > 0 ? <Badge variant="warning">Owing</Badge> : <Badge variant="success">Clear</Badge>}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </>
  );
}
