import { stockQuantity } from "@/lib/format";
import { TransfersConsole } from "@/features/operations/transfers-console";
import { WarehouseAdd } from "@/features/operations/warehouse-add";
import { Badge } from "@/components/ui/badge";
import { WarehouseCatalogTools } from "@/features/operations/warehouse-catalog-tools";
import { WarehouseLocations } from "@/features/operations/warehouse-locations";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { money } from "@/lib/format";
import { ExportButton } from "@/features/reports/export-button";
export default async function WarehouseStockPage() {
  const session = await getSession();
  if (!session?.activeStore) redirect("/onboarding");
  const locations = session.stores.filter(
    (s) =>
      s.businessId === session.activeStore!.businessId &&
      s.locationType === "warehouse" &&
      s.modules.warehouse,
  );
  const supabase = await createClient();
  const summary = await supabase.rpc("warehouse_summary", {
    p_business: session.activeStore.businessId,
  });
  if (summary.error) throw summary.error;
  const metadata = locations.length
    ? await supabase
        .from("stores")
        .select("id,code")
        .in(
          "id",
          locations.map((s) => s.id),
        )
    : { data: [], error: null };
  if (metadata.error) throw metadata.error;
  const { data, error } = locations.length
    ? await supabase
        .from("v_product_catalog")
        .select("*")
        .is("bulk_parent_id", null)
        .in(
          "store_id",
          locations.map((s) => s.id),
        )
        .order("name")
        .limit(1000)
    : { data: [], error: null };
  if (error) throw error;
  const rows = (data ?? []).map((p) => ({
    ...p,
    currency:
      locations.find((s) => s.id === p.store_id)?.currency ??
      session.activeStore!.currency,
    location: locations.find((s) => s.id === p.store_id)?.name ?? "Warehouse",
  }));
  return (
    <>
      <PageHeader
        title="Warehouse"
        description="Stock held in your permitted warehouses. These quantities are separate from each shop's saleable stock."
        crumbs={[{ label: "Administration" }, { label: "Warehouse" }]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <WarehouseCatalogTools />
            <WarehouseAdd />
            <ExportButton
              prominent
              rows={rows.map((r) => ({
                ...r,
                quantity:
                  r.tracking_type === "SALES_ONLY"
                    ? "N/A – Sales Tracked Only"
                    : r.quantity,
                bulk_stock: (r.bulk_options ?? [])
                  .map((b) => `${b.quantity} ${b.unit} × ${b.units_per_pack}`)
                  .join(", "),
                tracking:
                  r.tracking_type === "SALES_ONLY"
                    ? "Sales Tracked Only"
                    : "Quantity Tracked",
              }))}
              filename="warehouse-stock"
              columns={[
                { key: "location", label: "Warehouse" },
                { key: "name", label: "Product" },
                { key: "tracking", label: "Stock Tracking" },
                { key: "bulk_stock", label: "Bulk Stock" },
                { key: "sku", label: "SKU" },
                { key: "cost_price", label: "Unit cost" },
                { key: "quantity", label: "Quantity" },
                { key: "unit", label: "Unit" },
                { key: "stock_value", label: "Cost value" },
                { key: "currency", label: "Currency" },
              ]}
            />
          </div>
        }
      />
      <WarehouseLocations
        rows={(summary.data ?? []).map((row) => ({
          ...row,
          code: metadata.data?.find((s) => s.id === row.location_id)?.code,
        }))}
      />
      <section className="my-5">
        <TransfersConsole historyOnly />
      </section>
      <h2 className="my-5 text-lg font-semibold">Warehouse Stock View</h2>
      {!locations.length ? (
        <p className="text-muted">
          No warehouse is assigned to your account. Owners can create warehouses
          above and assign staff in Users.
        </p>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Warehouse</TH>
              <TH>Product</TH>
              <TH>Item Type</TH>
              <TH>Bulk Stock</TH>
              <TH>SKU / Barcode</TH>
              <TH>Quantity</TH>
              <TH>Unit cost</TH>
              <TH>Status</TH>
              <TH>Cost value</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((p) => (
              <TR key={p.id}>
                <TD>{p.location}</TD>
                <TD>{p.name}</TD>
                <TD>
                  {p.tracking_type === "SALES_ONLY"
                    ? "Sales Tracked Only"
                    : "Individual"}
                </TD>
                <TD>
                  {p.bulk_enabled
                    ? (p.bulk_options ?? [])
                        .map(
                          (b) =>
                            `${b.quantity} ${b.unit} × ${b.units_per_pack}`,
                        )
                        .join(", ") || "0"
                    : "Not enabled"}
                </TD>
                <TD>
                  {p.sku || "—"}
                  <p className="text-xs text-muted">
                    {p.barcodes || "No barcode"}
                  </p>
                </TD>
                <TD
                  className={
                    p.tracking_type === "SALES_ONLY"
                      ? "text-muted"
                      : Number(p.quantity) > 0
                        ? "text-success"
                        : "text-danger"
                  }
                >
                  {stockQuantity(p)} {p.unit}
                </TD>
                <TD>{money(p.cost_price, p.currency)}</TD>
                <TD>
                  <Badge
                    variant={
                      p.tracking_type === "SALES_ONLY"
                        ? "neutral"
                        : Number(p.quantity) > 0
                          ? "success"
                          : "danger"
                    }
                  >
                    {p.tracking_type === "SALES_ONLY"
                      ? "Sales Tracked Only"
                      : Number(p.quantity) > 0
                        ? "In Stock"
                        : "Out of Stock"}
                  </Badge>
                </TD>
                <TD>{money(p.stock_value, p.currency)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      {rows.length === 1000 ? (
        <p className="mt-4 text-sm text-muted">
          Showing the first 1,000 products. Open Check Stock at a specific
          warehouse for a narrower view.
        </p>
      ) : null}
    </>
  );
}
