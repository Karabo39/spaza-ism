import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ExportButton } from "@/features/reports/export-button";
import { money, qty } from "@/lib/format";
export default async function QuantitySalesReport({
  searchParams,
}: {
  searchParams: Promise<{
    store?: string;
    from?: string;
    to?: string;
    product?: string;
    cashier?: string;
    tracking?: string;
  }>;
}) {
  const sp = await searchParams;
  const session = await getSession("reports");
  if (!session?.activeStore) redirect("/onboarding");
  const stores = session.stores.filter((s) => s.modules.reports);
  const store = sp.store
    ? stores.find((s) => s.id === sp.store)
    : session.activeStore;
  if (!store) redirect("/no-access");
  const db = await createClient();
  const [{ data, error }, { data: products }, { data: staff }] =
    await Promise.all([
      db.rpc("quantity_sales_report", {
        p_store: store.id,
        p_from: sp.from || null,
        p_to: sp.to || null,
        p_product: sp.product || null,
        p_cashier: sp.cashier || null,
        p_tracking: sp.tracking || null,
      }),
      db
        .from("v_product_catalog")
        .select("id,name")
        .eq("store_id", store.id)
        .is("bulk_parent_id", null)
        .order("name"),
      db.from("profiles").select("id,full_name").order("full_name"),
    ]);
  if (error) throw error;
  const rows = (data ?? []).map((r) => ({
    ...r,
    tracking:
      r.tracking_type === "SALES_ONLY"
        ? "Sales Tracked Only"
        : "Quantity Tracked",
  }));
  const columns = [
    { key: "name", label: "Product" },
    { key: "tracking", label: "Tracking Type" },
    { key: "sold_qty", label: "Units Sold" },
    { key: "returned_qty", label: "Units Returned" },
    { key: "net_qty", label: "Net Units Sold" },
    { key: "revenue", label: "Net Revenue" },
  ];
  const selectClass =
    "h-11 w-full rounded-md border border-border bg-input px-3 text-sm";
  return (
    <>
      <PageHeader
        title="Quantity vs Sales Report"
        description={`Sales and approved returns at ${store.name}. Returns are deducted on the date approved and attributed to the original cashier. Invoice goods are counted once when issued.`}
        crumbs={[
          { label: "Reports", href: "/reports" },
          { label: "Quantity vs Sales Report" },
        ]}
        actions={
          <ExportButton
            rows={rows}
            columns={columns}
            filename="quantity-vs-sales"
          />
        }
      />
      <form className="mb-5 grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-sm">
          Store
          <select name="store" defaultValue={store.id} className={selectClass}>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          From
          <input
            name="from"
            type="date"
            defaultValue={sp.from}
            className={selectClass}
          />
        </label>
        <label className="text-sm">
          To
          <input
            name="to"
            type="date"
            defaultValue={sp.to}
            className={selectClass}
          />
        </label>
        <label className="text-sm">
          Product
          <select
            name="product"
            defaultValue={sp.product ?? ""}
            className={selectClass}
          >
            <option value="">All products</option>
            {products?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Cashier / User
          <select
            name="cashier"
            defaultValue={sp.cashier ?? ""}
            className={selectClass}
          >
            <option value="">All cashiers</option>
            {staff?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name ?? "Team member"}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Tracking Type
          <select
            name="tracking"
            defaultValue={sp.tracking ?? ""}
            className={selectClass}
          >
            <option value="">All tracking types</option>
            <option value="QUANTITY">Quantity Tracked</option>
            <option value="SALES_ONLY">Sales Tracked Only</option>
          </select>
        </label>
        <Button type="submit">Apply filters</Button>
      </form>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <Table>
          <THead>
            <TR>
              {columns.map((c) => (
                <TH key={c.key}>{c.label}</TH>
              ))}
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.product_id}>
                <TD>{r.name}</TD>
                <TD>{r.tracking}</TD>
                <TD>{qty(r.sold_qty)}</TD>
                <TD>{qty(r.returned_qty)}</TD>
                <TD>{qty(r.net_qty)}</TD>
                <TD>{money(r.revenue, store.currency)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!rows.length && (
          <p className="p-6 text-sm text-muted">
            No products match these filters.
          </p>
        )}
      </div>
    </>
  );
}
