import { redirect } from "next/navigation";
import { getSession, hasRole } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { DateFilter } from "@/features/reports/date-filter";
import { dateTime } from "@/lib/format";
import { ScrollText, Lock } from "lucide-react";

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session?.activeStore) redirect("/onboarding");
  const store = session.activeStore;

  if (!hasRole(store.role, "manager")) {
    return (
      <>
        <PageHeader title="Audit" crumbs={[{ label: "Administration" }, { label: "Audit" }]} />
        <EmptyState icon={Lock} title="Managers only" description="Audit history is available to managers and owners." />
      </>
    );
  }

  const supabase = await createClient();
  let query = supabase.from("audit_logs").select("id, action, entity_type, entity_id, actor_id, created_at, after_data").eq("business_id", store.businessId);
  if (sp.from) query = query.gte("created_at", sp.from);
  if (sp.to) query = query.lte("created_at", `${sp.to}T23:59:59`);
  const { data } = await query.order("created_at", { ascending: false }).limit(300);
  const rows = data ?? [];

  const actorIds = Array.from(new Set(rows.map((r) => r.actor_id).filter(Boolean))) as string[];
  const { data: profiles } = actorIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", actorIds)
    : { data: [] as { id: string; full_name: string | null }[] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name ?? "Unknown"]));

  return (
    <>
      <PageHeader title="Audit" crumbs={[{ label: "Administration" }, { label: "Audit" }]}
        description="A record of important actions across your business."
        actions={<DateFilter />} />
      <div className="rounded-lg border border-border bg-surface">
        {rows.length === 0 ? <EmptyState icon={ScrollText} title="No audit entries in this range" /> : (
          <Table>
            <THead><TR><TH>When</TH><TH>Action</TH><TH>Entity</TH><TH>By</TH></TR></THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD className="text-xs text-muted whitespace-nowrap">{dateTime(r.created_at)}</TD>
                  <TD><Badge variant="neutral">{r.action}</Badge></TD>
                  <TD className="text-muted">{r.entity_type ?? "—"}</TD>
                  <TD>{r.actor_id ? nameById.get(r.actor_id) ?? "Unknown" : "System"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </>
  );
}
