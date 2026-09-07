import { redirect } from "next/navigation";
import { getSession, hasRole } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { DateFilter } from "@/features/reports/date-filter";
import { ExportButton } from "@/features/reports/export-button";
import { businessDayStart, businessDayAfter } from "@/lib/business-date";
import { dateTime } from "@/lib/format";
import { ScrollText, Lock } from "lucide-react";

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const session = await getSession("audit");
  if (!session?.activeStore) redirect("/onboarding");
  const store = session.activeStore;

  if (!hasRole(store.role, "manager")) {
    return (
      <>
        <PageHeader
          title="Audit"
          crumbs={[{ label: "Administration" }, { label: "Audit" }]}
        />
        <EmptyState
          icon={Lock}
          title="Managers only"
          description="Audit history is available to managers and owners."
        />
      </>
    );
  }

  const supabase = await createClient();
  let query = supabase
    .from("v_audit_activity")
    .select("*")
    .eq("business_id", store.businessId);
  if (sp.from) query = query.gte("created_at", businessDayStart(sp.from));
  if (sp.to) query = query.lt("created_at", businessDayAfter(sp.to));
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw error;
  const rows = data ?? [];

  return (
    <>
      <PageHeader
        title="Audit"
        crumbs={[{ label: "Administration" }, { label: "Audit" }]}
        description="Actions in your permitted locations, including the stock items, responsible person and recorded changes."
        actions={
          <>
            <DateFilter />
            <ExportButton
              filename="audit-history"
              rows={rows.map((r) => ({
                when: dateTime(r.created_at),
                action: r.action,
                location: r.location_name,
                stock: r.stock_items,
                by: r.actor_name,
                reference: r.entity_id,
                before: JSON.stringify(r.before_data),
                after: JSON.stringify(r.after_data),
              }))}
              columns={[
                { key: "when", label: "When" },
                { key: "action", label: "Action" },
                { key: "location", label: "Location" },
                { key: "stock", label: "Stock items" },
                { key: "by", label: "By" },
                { key: "reference", label: "Record ID" },
                { key: "before", label: "Before" },
                { key: "after", label: "After" },
              ]}
            />
          </>
        }
      />
      {rows.length === 300 && (
        <p className="mb-4 text-sm text-warning">
          Latest 300 matching actions. Narrow the date range to review earlier
          history.
        </p>
      )}
      <div className="rounded-lg border border-border bg-surface">
        {rows.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="No audit entries in this range"
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>When</TH>
                <TH>Action</TH>
                <TH>Location / stock items</TH>
                <TH>By</TH>
                <TH>Changes</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD className="text-xs text-muted whitespace-nowrap">
                    {dateTime(r.created_at)}
                  </TD>
                  <TD>
                    <Badge variant="neutral">{r.action}</Badge>
                  </TD>
                  <TD>
                    <p>{r.location_name ?? "Business"}</p>
                    <p className="max-w-sm text-sm text-muted">
                      {r.stock_items || "—"}
                    </p>
                  </TD>
                  <TD>
                    {r.actor_id
                      ? (r.actor_name ?? "Recorded staff member")
                      : "System"}
                  </TD>
                  <TD>
                    <details>
                      <summary className="cursor-pointer text-accent">
                        View details
                      </summary>
                      <p className="mt-2 max-w-xs break-all text-xs">
                        {r.entity_type}: {r.entity_id}
                      </p>
                      <pre className="mt-2 max-h-64 max-w-sm overflow-auto whitespace-pre-wrap break-all text-xs">
                        {JSON.stringify(
                          { before: r.before_data, after: r.after_data },
                          null,
                          2,
                        )}
                      </pre>
                    </details>
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
