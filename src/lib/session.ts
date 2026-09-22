import { activeSellingStore } from "./location-scope";
import { cookies } from "next/headers";
import { cache } from "react";
import { redirect } from "next/navigation";
import {
  modulePermissions,
  firstModulePath,
  type ModuleKey,
  type ModulePermissions,
} from "@/lib/modules";
import { createClient } from "@/lib/supabase/server";
import type { MembershipRole, LocationType } from "@/lib/db/database.types";
import { ACTIVE_STORE_COOKIE } from "@/lib/constants";

export { ACTIVE_STORE_COOKIE };

export type SessionStore = {
  id: string;
  name: string;
  businessId: string;
  businessName: string;
  role: MembershipRole;
  currency: string;
  locationType: LocationType;
  modules: ModulePermissions;
};

export type Session = {
  userId: string;
  email: string | null;
  fullName: string | null;
  stores: SessionStore[];
  activeStore: SessionStore | null;
  hasMembership: boolean;
  accessRevision: string;
};

type SessionBootstrap = {
  setup_required: boolean;
  full_name: string | null;
  has_membership: boolean;
  revision: string;
  stores: {
    id: string;
    name: string;
    business_id: string;
    business_name: string;
    role: MembershipRole;
    currency: string;
    location_type: LocationType;
    permissions: unknown;
  }[];
};

/**
 * Loads the signed-in user's accessible stores (with their role per business)
 * and resolves the active store from the cookie. Returns null if unauthenticated.
 * `stores` empty => user needs onboarding.
 */
const loadSession = cache(async (): Promise<Session | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase.rpc("session_bootstrap", {});
  if (error || !data) throw new Error("SERVICE_TEMPORARILY_UNAVAILABLE");
  const bootstrap = data as unknown as SessionBootstrap;
  if (bootstrap.setup_required) redirect("/accept-invitation");
  const sessionStores: SessionStore[] = bootstrap.stores
    .map((s) => ({
      id: s.id,
      name: s.name,
      businessId: s.business_id,
      businessName: s.business_name,
      role: s.role,
      currency: s.currency,
      locationType: s.location_type,
      modules: modulePermissions(s.role, s.permissions ?? undefined),
    }))
    .filter((s) => s.locationType !== "warehouse" || s.modules.warehouse);

  const cookieStore = await cookies();
  const preferred = cookieStore.get(ACTIVE_STORE_COOKIE)?.value;
  const activeStore = activeSellingStore(sessionStores, preferred);

  return {
    userId: user.id,
    email: user.email ?? null,
    fullName: bootstrap.full_name ?? user.email ?? null,
    stores: sessionStores,
    activeStore,
    hasMembership: bootstrap.has_membership,
    accessRevision: bootstrap.revision,
  };
});

export async function getSession(
  requiredModule?: ModuleKey,
): Promise<Session | null> {
  const session = await loadSession();
  if (requiredModule) {
    if (!session) redirect("/login");
    if (!session.activeStore)
      redirect(session.hasMembership ? "/access-pending" : "/onboarding");
    if (
      session.activeStore.locationType === "warehouse" &&
      requiredModule !== "warehouse"
    )
      redirect("/warehouse");
    if (!session.activeStore.modules[requiredModule]) {
      redirect(
        requiredModule === "dashboard"
          ? firstModulePath(session.activeStore.modules)
          : "/no-access",
      );
    }
  }
  return session;
}

/** Role hierarchy check used in server components. */
export function hasRole(role: MembershipRole, min: MembershipRole): boolean {
  const rank = { employee: 1, manager: 2, owner: 3 } as const;
  return rank[role] >= rank[min];
}
