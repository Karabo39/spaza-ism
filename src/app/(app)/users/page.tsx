import { redirect } from "next/navigation";
import { getSession, hasRole } from "@/lib/session";
import { PageHeader } from "@/components/shell/page-header";
import { UsersManager } from "@/features/users/users-manager";
import { EmptyState } from "@/components/ui/misc";
import { Lock } from "lucide-react";

export default async function UsersPage() {
  const session = await getSession();
  if (!session?.activeStore) redirect("/onboarding");
  const allowed = hasRole(session.activeStore.role, "owner");

  return (
    <>
      <PageHeader title="Users" crumbs={[{ label: "Administration" }, { label: "Users" }]}
        description="Manage who can access your business and what they can do." />
      {allowed ? <UsersManager /> : (
        <EmptyState icon={Lock} title="Owners only" description="Only the business owner can manage users." />
      )}
    </>
  );
}
