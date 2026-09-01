import { PageHeader } from "@/components/shell/page-header";
import { GoodsOutConsole } from "@/features/goods-out/goods-out-console";

export default function GoodsOutPage() {
  return (
    <>
      <PageHeader
        title="Goods Out"
        crumbs={[{ label: "Operations" }, { label: "Goods Out" }]}
        description="Scan products, choose cash or credit, and complete the sale."
      />
      <GoodsOutConsole />
    </>
  );
}
