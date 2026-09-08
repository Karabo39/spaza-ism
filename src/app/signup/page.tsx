import { createClient } from "@/lib/supabase/server";
import SignupForm from "@/features/onboarding/signup-form";
import Link from "next/link";
export default async function SignupPage() {
  const { data, error } = await (
    await createClient()
  ).rpc("registration_open", {});
  if (error || !data)
    return (
      <main className="mx-auto max-w-md space-y-4 p-8">
        <h1 className="text-xl font-semibold">Registration is by invitation</h1>
        <p>Ask your employer to invite you to POS INVENTORY.</p>
        <Link href="/login" className="text-accent">
          Sign in
        </Link>
      </main>
    );
  return <SignupForm />;
}
