import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { qty, money } from "@/lib/format";
import { ExportButton } from "@/features/reports/export-button";
export default async function WarehouseStockPage() {
  const session = await getSession("operations"); if (!session?.activeStore) redirect("/onboarding");
  const locations = session.stores.filter((s) => s.businessId === session.activeStore!.businessId && s.locationType === "warehouse");
  const supabase = await createClient();
  const { data, error } = locations.length ? await supabase.from("v_product_stock").select("*").in("store_id", locations.map((s) => s.id)).order("name").limit(1000) : { data: [], error: null };
  if (error) throw error;
  const rows = (data ?? []).map((p) => ({ ...p, currency: locations.find(s=>s.id===p.store_id)?.currency ?? session.activeStore!.currency, location: locations.find((s) => s.id === p.store_id)?.name ?? "Warehouse" }));
  return <><PageHeader title="Warehouse stock" description="Stock held in your permitted warehouses. These quantities are separate from each shop's saleable stock." crumbs={[{ label: "Operations", href: "/operations" }, { label: "Warehouse stock" }]} actions={<ExportButton rows={rows} filename="warehouse-stock" columns={[{ key: "location", label: "Warehouse" }, { key: "name", label: "Product" }, { key: "quantity", label: "Quantity" }, { key: "unit", label: "Unit" }, { key: "stock_value", label: "Cost value" }, {key:"currency",label:"Currency"}]} />} />
    {!locations.length ? <p className="text-muted">No warehouse is assigned to your account. Owners can create warehouses in Settings and assign staff in Users.</p> : <Table><THead><TR><TH>Warehouse</TH><TH>Product</TH><TH>Quantity</TH><TH>Cost value</TH></TR></THead><TBody>{rows.map((p) => <TR key={p.id}><TD>{p.location}</TD><TD>{p.name}</TD><TD>{qty(p.quantity)} {p.unit}</TD><TD>{money(p.stock_value, p.currency)}</TD></TR>)}</TBody></Table>}
    {rows.length === 1000 ? <p className="mt-4 text-sm text-muted">Showing the first 1,000 products. Open Check Stock at a specific warehouse for a narrower view.</p> : null}
  </>;
}
