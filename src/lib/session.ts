import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import type { MembershipRole } from "@/lib/db/database.types";
import { ACTIVE_STORE_COOKIE } from "@/lib/constants";

export { ACTIVE_STORE_COOKIE };

export type SessionStore = {
  id: string;
  name: string;
  businessId: string;
  businessName: string;
  role: MembershipRole;
  currency: string;
};

export type Session = {
  userId: string;
  email: string | null;
  fullName: string | null;
  stores: SessionStore[];
  activeStore: SessionStore | null;
};

/**
 * Loads the signed-in user's accessible stores (with their role per business)
 * and resolves the active store from the cookie. Returns null if unauthenticated.
 * `stores` empty => user needs onboarding.
 */
export async function getSession(): Promise<Session | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: memberships }, { data: stores }, { data: profile }] = await Promise.all([
    supabase.from("memberships").select("business_id, role, businesses(name, currency)").eq("is_active", true),
    supabase.from("stores").select("id, name, business_id").eq("is_active", true).order("name"),
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
  ]);

  const roleByBusiness = new Map<string, { role: MembershipRole; name: string; currency: string }>();
  for (const m of memberships ?? []) {
    const biz = m.businesses as unknown as { name: string; currency: string } | null;
    roleByBusiness.set(m.business_id, {
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
      };
    });

  const cookieStore = await cookies();
  const preferred = cookieStore.get(ACTIVE_STORE_COOKIE)?.value;
  const activeStore =
    sessionStores.find((s) => s.id === preferred) ?? sessionStores[0] ?? null;

  return {
    userId: user.id,
    email: user.email ?? null,
    fullName: profile?.full_name ?? user.email ?? null,
    stores: sessionStores,
    activeStore,
  };
}

/** Role hierarchy check used in server components. */
export function hasRole(role: MembershipRole, min: MembershipRole): boolean {
  const rank = { employee: 1, manager: 2, owner: 3 } as const;
  return rank[role] >= rank[min];
}
