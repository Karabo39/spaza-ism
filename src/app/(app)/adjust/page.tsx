import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/shell/page-header";
import { AdjustConsole } from "@/features/adjust/adjust-console";
import { EmptyState } from "@/components/ui/misc";
import { Lock } from "lucide-react";

export default async function AdjustPage() {
  const session = await getSession("adjust");
  if (!session?.activeStore) redirect("/onboarding");
  const allowed = session.activeStore.modules.adjust;

  return (
    <>
      <PageHeader
        title="Adjust Stock"
        crumbs={[{ label: "Stock Control" }, { label: "Adjust Stock" }]}
        description="Correct stock quantities. Every adjustment is logged with a reason and your name."
      />
      {allowed ? (
        <AdjustConsole />
      ) : (
        <EmptyState
          icon={Lock}
          title="Access required"
          description="Stock adjustments require access to this module. Ask your owner to grant access or make the correction."
        />
      )}
    </>
  );
}
