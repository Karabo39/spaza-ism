import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import OnboardingForm from "@/features/onboarding/onboarding-form";

export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.activeStore) redirect("/");
  if (session.hasMembership) redirect("/access-pending");
  const db = await createClient();
  const [{ data: open, error }, { data: setup }] = await Promise.all([
    db.rpc("registration_open", {}),
    db.rpc("my_employee_setup", {}),
  ]);
  if (error || !open || (setup as { managed?: boolean } | null)?.managed)
    redirect("/access-pending");
  return <OnboardingForm />;
}
