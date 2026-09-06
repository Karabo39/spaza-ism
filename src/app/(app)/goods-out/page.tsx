import { PageHeader } from "@/components/shell/page-header";
import { GoodsOutConsole } from "@/features/goods-out/goods-out-console";
import { getSession } from "@/lib/session";
import Link from "next/link";

export default async function GoodsOutPage() {
  const session = await getSession();
  if (session?.activeStore?.locationType === "warehouse") return (
    <>
      <PageHeader title="Warehouse stock cannot be sold" description="Switch to a selling store to record Goods Out. Warehouse stock must first be transferred and received at that store." />
      <Link href="/check-stock" className="text-primary-hover underline">View warehouse stock</Link>
    </>
  );
  return (
    <>
      <PageHeader
        title="Goods Out"
        crumbs={[{ label: "Operations" }, { label: "Goods Out" }]}
        description="Scan products, choose Cash, Card/EFT or Credit, and record the sale."
      />
      <GoodsOutConsole />
    </>
  );
}
