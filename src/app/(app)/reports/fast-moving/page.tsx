import { MovingReport } from "@/features/reports/moving-report";

export default function FastMovingPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  return <MovingReport direction="fast" searchParams={searchParams} />;
}
