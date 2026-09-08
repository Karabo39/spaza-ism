import { cookies } from "next/headers";
import { cache } from "react";
import { redirect } from "next/navigation";
import { databaseReady } from "@/lib/release-status";
import { modulePermissions, firstModulePath, type ModuleKey, type ModulePermissions } from "@/lib/modules";
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
  if (!(await databaseReady())) throw new Error("SERVICE_TEMPORARILY_UNAVAILABLE");

  const { data: setup, error: setupError } = await supabase.rpc("my_employee_setup", {});
  if (setupError) throw new Error("SERVICE_TEMPORARILY_UNAVAILABLE");
  if ((setup as { required?: boolean } | null)?.required) redirect("/accept-invitation");

  const [{ data: memberships }, { data: stores }, { data: profile }] = await Promise.all([
    supabase.from("memberships").select("id, business_id, role, businesses(name, currency)").eq("user_id", user.id).eq("is_active", true).throwOnError(),
    supabase.from("stores").select("id, name, business_id, location_type").eq("is_active", true).order("location_type").order("name").throwOnError(),
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
  ]);

  const { data: grants } = memberships?.length ? await supabase.from("store_module_access")
    .select("membership_id, store_id, permissions").in("membership_id", memberships.map((m) => m.id)).throwOnError() : { data: [] };
  const grantsByStore = new Map((grants ?? []).map((g) => [`${g.membership_id}:${g.store_id}`, g.permissions]));
  const roleByBusiness = new Map<string, { id: string; role: MembershipRole; name: string; currency: string }>();
  for (const m of memberships ?? []) {
    const biz = m.businesses as unknown as { name: string; currency: string } | null;
    roleByBusiness.set(m.business_id, {
      id: m.id,
      role: m.role,
      name: biz?.name ?? "Business",
      currency: biz?.currency ?? "ZAR",
    });
  }

  const sessionStores: SessionStore[] = (stores ?? [])
    .filter((s) => roleByBusiness.has(s.business_id))
    .map((s) => {
      const b = roleByBusiness.get(s.business_id)!;
      return {
        id: s.id,
        name: s.name,
        businessId: s.business_id,
        businessName: b.name,
        role: b.role,
        currency: b.currency,
        locationType: s.location_type,
        modules: modulePermissions(b.role, grantsByStore.get(`${b.id}:${s.id}`)),
      };
    });

  const cookieStore = await cookies();
  const preferred = cookieStore.get(ACTIVE_STORE_COOKIE)?.value;
  const activeStore =
    sessionStores.find((s) => s.id === preferred && Object.values(s.modules).some(Boolean)) ??
    sessionStores.find((s) => Object.values(s.modules).some(Boolean)) ?? sessionStores[0] ?? null;

  return {
    userId: user.id,
    email: user.email ?? null,
    fullName: profile?.full_name ?? user.email ?? null,
    stores: sessionStores,
    activeStore,
    hasMembership: (memberships ?? []).length > 0,
  };
});

export async function getSession(requiredModule?: ModuleKey): Promise<Session | null> {
  const session = await loadSession();
  if (requiredModule) {
    if (!session) redirect("/login");
    if (!session.activeStore) redirect(session.hasMembership ? "/access-pending" : "/onboarding");
    if (!session.activeStore.modules[requiredModule]) {
      redirect(requiredModule === "dashboard" ? firstModulePath(session.activeStore.modules) : "/no-access");
    }
  }
  return session;
}

/** Role hierarchy check used in server components. */
export function hasRole(role: MembershipRole, min: MembershipRole): boolean {
  const rank = { employee: 1, manager: 2, owner: 3 } as const;
  return rank[role] >= rank[min];
}
