import * as React from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { StoreProvider } from "@/lib/store-context";
import { OfflineProvider } from "@/lib/offline/offline-context";
import { AppShell } from "@/components/shell/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.activeStore) redirect(session.hasMembership ? "/access-pending" : "/onboarding");

  return (
    <StoreProvider key={`${session.userId}:${session.activeStore.id}:${session.activeStore.role}`} session={{ ...session, activeStore: session.activeStore }}>
      <OfflineProvider>
        <AppShell>{children}</AppShell>
      </OfflineProvider>
    </StoreProvider>
  );
}
