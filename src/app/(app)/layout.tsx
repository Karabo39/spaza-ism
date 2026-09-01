import * as React from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { StoreProvider } from "@/lib/store-context";
import { AppShell } from "@/components/shell/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.activeStore) redirect("/onboarding");

  return (
    <StoreProvider session={{ ...session, activeStore: session.activeStore }}>
      <AppShell>{children}</AppShell>
    </StoreProvider>
  );
}
