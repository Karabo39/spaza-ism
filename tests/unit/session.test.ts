import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSession } from "@/lib/session";

const mock = vi.hoisted(() => ({
  user: { id: "employee", email: "staff@example.test" } as { id: string; email: string } | null,
  preferred: "shop",
  memberships: [
    { user_id: "employee", business_id: "business", role: "employee", is_active: true, businesses: { name: "Business", currency: "ZAR" } },
    { user_id: "owner", business_id: "business", role: "owner", is_active: true, businesses: { name: "Business", currency: "ZAR" } },
  ],
  stores: [{ id: "shop", business_id: "business", name: "Shop", is_active: true, location_type: "store" }],
  error: false,
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: mock.preferred }) }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mock.user } }) },
    from(table: string) {
      let rows: Record<string, unknown>[] = table === "memberships" ? [...mock.memberships] : table === "stores" ? [...mock.stores] : [{ id: "employee", full_name: "Staff" }];
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { rows = rows.filter((r) => r[key] === value); return query; },
        order: () => query,
        maybeSingle: async () => ({ data: rows[0] ?? null }),
        throwOnError: async () => {
          if (mock.error) throw new Error("Database unavailable");
          return { data: rows };
        },
      };
      return query;
    },
  }),
}));

describe("session location access", () => {
  beforeEach(() => {
    mock.user = { id: "employee", email: "staff@example.test" };
    mock.preferred = "shop"; mock.error = false;
    mock.stores = [{ id: "shop", business_id: "business", name: "Shop", is_active: true, location_type: "store" }];
  });
  it("uses only the signed-in member's role even when other business members are readable", async () => {
    expect((await getSession())?.activeStore?.role).toBe("employee");
  });
  it("ignores a stale or forged preferred location cookie", async () => {
    mock.preferred = "unassigned";
    expect((await getSession())?.activeStore?.id).toBe("shop");
  });
  it("distinguishes an unassigned member from a new business owner", async () => {
    mock.stores = [];
    const session = await getSession();
    expect(session?.activeStore).toBeNull();
    expect(session?.hasMembership).toBe(true);
  });
  it("does not turn database failures into onboarding", async () => {
    mock.error = true;
    await expect(getSession()).rejects.toThrow("Database unavailable");
  });
  it("returns no session when signed out", async () => {
    mock.user = null;
    expect(await getSession()).toBeNull();
  });
});
