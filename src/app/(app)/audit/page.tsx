import { redirect } from "next/navigation";
import { getSession, hasRole } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { DateFilter } from "@/features/reports/date-filter";
import { ActivityExport } from "@/features/reports/paged-export";
import { type ActivityRow } from "@/features/reports/activity-data";
import { readCursor, dataPage } from "@/lib/data-pages";
import { CursorPagination } from "@/components/ui/cursor-pagination";
import { AuditDetails } from "@/features/reports/audit-details";
import { businessDayStart, businessDayAfter } from "@/lib/business-date";
import { dateTime } from "@/lib/format";
import { ScrollText, Lock } from "lucide-react";

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; cursor?: string }>;
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
  const { data, error } = await supabase.rpc("activity_page", {
    p_kind: "audit",
    p_scope: store.businessId,
    p_from: sp.from ? businessDayStart(sp.from) : null,
    p_to: sp.to ? businessDayAfter(sp.to) : null,
    p_after: readCursor(sp.cursor),
    p_limit: 50,
  });
  if (error) throw error;
  const { rows, next } = dataPage<ActivityRow>(data);

  return (
    <>
      <PageHeader
        title="Audit"
        crumbs={[{ label: "Administration" }, { label: "Audit" }]}
        description="Actions in your permitted locations, including the stock items, responsible person and recorded changes."
        actions={
          <>
            <DateFilter />
            <ActivityExport
              kind="audit"
              scope={store.businessId}
              from={sp.from ? businessDayStart(sp.from) : undefined}
              to={sp.to ? businessDayAfter(sp.to) : undefined}
              filename="audit-history"
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
                      Stock items in details
                    </p>
                  </TD>
                  <TD>
                    {r.actor_id
                      ? (r.actor_name ?? "Recorded staff member")
                      : "System"}
                  </TD>
                  <TD>
                    <AuditDetails id={r.id} businessId={store.businessId} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>
      <CursorPagination
        next={next}
        current={sp.cursor}
        count={rows.length}
        basePath="/audit"
        params={sp}
      />
    </>
  );
}
