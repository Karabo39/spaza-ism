import { warehouseSession } from "@/lib/warehouse-session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { qty, money } from "@/lib/format";
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
    .eq("is_active", true)
    .order("name")
    .limit(1000);
  if (error) throw error;
  return (
    <>
      <PageHeader
        title="Warehouse Stock View"
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
            <TH>SKU / Barcode</TH>
            <TH>Quantity</TH>
            <TH>Unit cost</TH>
            <TH>Status</TH>
          </TR>
        </THead>
        <TBody>
          {data?.map((p) => (
            <TR key={p.id}>
              <TD>{p.name}</TD>
              <TD>{p.sku || p.barcodes}</TD>
              <TD
                className={
                  Number(p.quantity) > 0 ? "text-success" : "text-danger"
                }
              >
                {qty(p.quantity)} {p.unit}
              </TD>
              <TD>{money(p.cost_price, session.activeStore.currency)}</TD>
              <TD>
                <Badge variant={Number(p.quantity) > 0 ? "success" : "danger"}>
                  {Number(p.quantity) > 0 ? "In Stock" : "Out of Stock"}
                </Badge>
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
