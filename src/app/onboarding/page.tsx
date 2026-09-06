import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import OnboardingForm from "@/features/onboarding/onboarding-form";

export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.activeStore) redirect("/");
  if (session.hasMembership) redirect("/access-pending");
  return <OnboardingForm />;
}
