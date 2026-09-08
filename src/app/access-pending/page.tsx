import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

export default async function AccessPendingPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.activeStore && Object.values(session.activeStore.modules).some(Boolean)) redirect("/");
  return (
    <main className="mx-auto flex min-h-[calc(100svh-4rem)] max-w-md flex-col justify-center gap-4 px-6">
      <h1 className="text-2xl font-semibold">Waiting for location access</h1>
      <p className="text-muted">Ask your employer to send an invitation or assign your stores and modules, then check again.</p>
      <Link href="/" className="focus-ring rounded-md bg-primary px-4 py-3 text-center text-primary-foreground">Check access again</Link>
    </main>
  );
}
