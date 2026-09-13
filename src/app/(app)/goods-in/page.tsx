import { PageHeader } from "@/components/shell/page-header";
import { GoodsInConsole } from "@/features/goods-in/goods-in-console";
import { TransfersConsole } from "@/features/operations/transfers-console";
import { getSession } from "@/lib/session";
export default async function GoodsInPage() {
  const session = await getSession("goods_in");
  const modules = session!.activeStore!.modules;
  return (
    <>
      <PageHeader
        title="Goods In"
        description="Receive supplier stock or confirm a dispatched transfer into this location."
      />
      {modules.goods_in_new_stock && (
        <section className="mb-8">
          <h2 className="mb-4 text-lg font-semibold">
            Receive New Stock / Supplier → Store
          </h2>
          <GoodsInConsole />
        </section>
      )}
      {modules.goods_in_receive_transfer && (
        <section>
          <h2 className="mb-4 text-lg font-semibold">
            Receive Stock Transfer / Warehouse → Store
          </h2>
          <TransfersConsole key={session!.activeStore!.id} receiving />
        </section>
      )}
      {!modules.goods_in_new_stock && !modules.goods_in_receive_transfer && (
        <p>
          Your owner can enable supplier receiving or transfer receiving in
          Access Control for this store.
        </p>
      )}
    </>
  );
}
