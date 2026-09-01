import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { StockTakeCounter } from "@/features/stock-take/counter";
import { dateTime } from "@/lib/format";

export default async function StockTakeDetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { id } = await params;
  const { q } = await searchParams;
  const session = await getSession();
  if (!session?.activeStore) redirect("/onboarding");
  const supabase = await createClient();

  const { data: take } = await supabase.from("stock_takes").select("id, status, created_at").eq("id", id).maybeSingle();
  if (!take) notFound();

  return (
    <>
      <PageHeader title="Stock Take" crumbs={[{ label: "Stock Take", href: "/stock-take" }, { label: dateTime(take.created_at) }]}
        description="Enter the physical count for each product. Completing applies the differences as adjustments." />
      <StockTakeCounter stockTakeId={take.id} status={take.status} filter={q} />
    </>
  );
}
