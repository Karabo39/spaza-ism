import { redirect } from "next/navigation";
import { getSession, hasRole } from "@/lib/session";
import { PageHeader } from "@/components/shell/page-header";
import { AdjustConsole } from "@/features/adjust/adjust-console";
import { EmptyState } from "@/components/ui/misc";
import { Lock } from "lucide-react";

export default async function AdjustPage() {
  const session = await getSession();
  if (!session?.activeStore) redirect("/onboarding");
  const allowed = hasRole(session.activeStore.role, "manager");

  return (
    <>
      <PageHeader title="Adjust Stock" crumbs={[{ label: "Stock Control" }, { label: "Adjust Stock" }]}
        description="Correct stock quantities. Every adjustment is logged with a reason and your name." />
      {allowed ? (
        <AdjustConsole />
      ) : (
        <EmptyState icon={Lock} title="Managers only"
          description="Stock adjustments require a manager or owner role. Ask your manager to make the correction." />
      )}
    </>
  );
}
