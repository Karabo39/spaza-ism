import { PageHeader } from "@/components/shell/page-header";
import { GoodsInConsole } from "@/features/goods-in/goods-in-console";

export default function GoodsInPage() {
  return (
    <>
      <PageHeader
        title="Goods In"
        crumbs={[{ label: "Operations" }, { label: "Goods In" }]}
        description="Receive stock from suppliers. Quantities are added to stock on confirmation."
      />
      <GoodsInConsole />
    </>
  );
}
