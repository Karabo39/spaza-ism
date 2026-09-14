import { warehouseSession } from "@/lib/warehouse-session";
import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { StockTakeCounter } from "@/features/stock-take/counter";
import { dateTime } from "@/lib/format";

export default async function StockTakeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; warehouseId: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { id, warehouseId } = await params;
  const { q } = await searchParams;
  const session = await warehouseSession(warehouseId, "stock_take");
  if (!session?.activeStore) redirect("/onboarding");
  const supabase = await createClient();

  const { data: take } = await supabase
    .from("stock_takes")
    .select("id, status, created_at")
    .eq("id", id)
    .eq("store_id", session.activeStore.id)
    .maybeSingle();
  if (!take) notFound();

  return (
    <>
      <PageHeader
        title="Stock Take"
        crumbs={[
          { label: "Stock Take", href: `/warehouse/${warehouseId}/stock-take` },
          { label: dateTime(take.created_at) },
        ]}
        description="Enter the physical count for each product. Completing applies the differences as adjustments."
      />
      <StockTakeCounter stockTakeId={take.id} status={take.status} filter={q} />
    </>
  );
}
