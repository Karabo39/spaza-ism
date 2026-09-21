import { ProductEditDialog } from "@/features/products/product-edit-dialog";
import { AddProductButton } from "@/features/products/add-product-button";
import { stockQuantity } from "@/lib/format";
import { warehouseSession } from "@/lib/warehouse-session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { money } from "@/lib/format";
export default async function Page({
  params,
}: {
  params: Promise<{ warehouseId: string }>;
}) {
  const { warehouseId } = await params;
  const session = await warehouseSession(warehouseId, "check_stock");
  const db = await createClient();
  const { data, error } = await db
    .from("v_product_catalog")
    .select("*")
    .eq("store_id", warehouseId)
    .is("bulk_parent_id", null)
    .eq("is_active", true)
    .order("name")
    .limit(1000);
  if (error) throw error;
  return (
    <>
      <PageHeader
        title="Warehouse Stock View"
        actions={
          session.activeStore.modules.products &&
          session.activeStore.role !== "employee" ? (
            <AddProductButton />
          ) : undefined
        }
        description={session.activeStore.name}
        crumbs={[
          { label: "Warehouse", href: "/warehouse" },
          { label: "View Stock" },
        ]}
      />
      <Table>
        <THead>
          <TR>
            <TH>Product</TH>
            <TH>Item Type</TH>
            <TH>Bulk Stock</TH>
            <TH>SKU / Barcode</TH>
            <TH>Quantity</TH>
            <TH>Unit cost</TH>
            <TH>Status</TH>
            <TH>Edit</TH>
          </TR>
        </THead>
        <TBody>
          {data?.map((p) => (
            <TR key={p.id}>
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
                        (b) => `${b.quantity} ${b.unit} × ${b.units_per_pack}`,
                      )
                      .join(", ") || "0"
                  : "Not enabled"}
              </TD>
              <TD>{p.sku || p.barcodes}</TD>
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
              <TD>{money(p.cost_price, session.activeStore.currency)}</TD>
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
              <TD>
                {session.activeStore.modules.products &&
                  session.activeStore.role !== "employee" && (
                    <ProductEditDialog
                      product={p}
                      barcode={p.barcodes?.split(", ")[0] ?? ""}
                    />
                  )}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
      {!data?.length && <p>No warehouse stock products.</p>}
      {data?.length === 1000 && <p>First 1,000 products shown.</p>}
    </>
  );
}
