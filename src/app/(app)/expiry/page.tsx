import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { qty, dateOnly } from "@/lib/format";
import { CalendarClock } from "lucide-react";
import { ExportButton } from "@/features/reports/export-button";
import { businessDate } from "@/lib/business-date";
import { Pagination } from "@/components/ui/pagination";

export default async function ExpiryPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Math.floor(Number(sp.page) || 1));
  const pageSize = 100;
  const session = await getSession();
  if (!session?.activeStore) redirect("/onboarding");
  const store = session.activeStore;
  const supabase = await createClient();

  const { data, error, count } = await supabase
    .from("stock_batches")
    .select("id, expiry_date, quantity, batch_ref, products(name)", {
      count: "exact",
    })
    .eq("store_id", store.id)
    .gt("quantity", 0)
    .not("expiry_date", "is", null)
    .order("expiry_date")
    .order("id")
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw error;
  const rows = (data ?? []) as unknown as {
    id: string;
    expiry_date: string;
    quantity: number;
    batch_ref: string | null;
    products: { name: string } | null;
  }[];

  const today = new Date(`${businessDate()}T00:00:00Z`);
  function statusFor(d: string) {
    const exp = new Date(d);
    const days = Math.ceil((exp.getTime() - today.getTime()) / 86400000);
    if (days < 0) return { label: "Expired", variant: "danger" as const, days };
    if (days <= 30)
      return { label: `${days}d left`, variant: "warning" as const, days };
    return { label: `${days}d left`, variant: "neutral" as const, days };
  }

  return (
    <>
      <PageHeader
        title="Expiry"
        crumbs={[{ label: "Stock Control" }, { label: "Expiry" }]}
        description="Batches approaching or past expiry. Write off expired stock via Adjust Stock (Expired)."
        actions={
          <ExportButton
            rows={rows.map((r) => ({
              product: r.products?.name ?? "",
              batch: r.batch_ref ?? "",
              quantity: r.quantity,
              expiry: r.expiry_date,
              status: statusFor(r.expiry_date).label,
            }))}
            columns={[
              { key: "product", label: "Product" },
              { key: "batch", label: "Batch" },
              { key: "quantity", label: "Quantity" },
              { key: "expiry", label: "Expiry date" },
              { key: "status", label: "Status" },
            ]}
            filename="expiry"
          />
        }
      />
      <p className="mb-4 text-sm text-muted">
        {rows.length} batches on this page. Exports cover this page.
      </p>
      <div className="rounded-lg border border-border bg-surface">
        {rows.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="No expiry-tracked batches"
            description="Enable “Track expiry” on a product and capture expiry dates during Goods In."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Product</TH>
                <TH>Batch</TH>
                <TH className="text-right">Qty</TH>
                <TH>Expiry date</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => {
                const s = statusFor(r.expiry_date);
                return (
                  <TR key={r.id}>
                    <TD className="font-medium">{r.products?.name ?? "—"}</TD>
                    <TD className="text-muted">{r.batch_ref ?? "—"}</TD>
                    <TD className="text-right tabular-nums">
                      {qty(r.quantity)}
                    </TD>
                    <TD>{dateOnly(r.expiry_date)}</TD>
                    <TD>
                      <Badge variant={s.variant}>{s.label}</Badge>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </div>
      <Pagination
        page={page}
        pageSize={pageSize}
        total={count ?? 0}
        params={{}}
        basePath="/expiry"
      />
    </>
  );
}
