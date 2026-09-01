import { MovingReport } from "@/features/reports/moving-report";

export default function SlowMovingPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  return <MovingReport direction="slow" searchParams={searchParams} />;
}
