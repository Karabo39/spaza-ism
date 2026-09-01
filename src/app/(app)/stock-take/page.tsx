import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { StartStockTakeButton } from "@/features/stock-take/start-button";
import { dateTime } from "@/lib/format";
import { ClipboardList } from "lucide-react";

export default async function StockTakePage() {
  const session = await getSession();
  if (!session?.activeStore) redirect("/onboarding");
  const store = session.activeStore;
  const supabase = await createClient();

  const { data } = await supabase.from("stock_takes").select("id, status, note, created_at, completed_at")
    .eq("store_id", store.id).order("created_at", { ascending: false }).limit(50);
  const rows = data ?? [];

  return (
    <>
      <PageHeader title="Stock Take" crumbs={[{ label: "Stock Control" }, { label: "Stock Take" }]}
        description="Count physical stock and reconcile it against the system."
        actions={<StartStockTakeButton />} />

      <div className="rounded-lg border border-border bg-surface">
        {rows.length === 0 ? (
          <EmptyState icon={ClipboardList} title="No stock takes yet"
            description="Start a stock take to count your shelves and correct any differences." />
        ) : (
          <Table>
            <THead><TR><TH>Started</TH><TH>Status</TH><TH>Completed</TH><TH>Note</TH></TR></THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD><Link href={`/stock-take/${r.id}`} className="font-medium hover:text-primary-hover">{dateTime(r.created_at)}</Link></TD>
                  <TD><Badge variant={r.status === "COMPLETED" ? "success" : r.status === "CANCELLED" ? "neutral" : "warning"}>{r.status.replace("_", " ")}</Badge></TD>
                  <TD className="text-muted">{r.completed_at ? dateTime(r.completed_at) : "—"}</TD>
                  <TD className="text-muted">{r.note ?? "—"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </>
  );
}
