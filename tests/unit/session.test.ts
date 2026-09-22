import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSession } from "@/lib/session";

const mock = vi.hoisted(() => ({
  user: { id: "employee", email: "staff@example.test" } as {
    id: string;
    email: string;
  } | null,
  preferred: "shop",
  ready: true,
  setupRequired: false,
  grants: [] as Record<string, unknown>[],
  memberships: [
    {
      id: "staff-member",
      user_id: "employee",
      business_id: "business",
      role: "employee",
      is_active: true,
      businesses: { name: "Business", currency: "ZAR" },
    },
    {
      id: "owner-member",
      user_id: "owner",
      business_id: "business",
      role: "owner",
      is_active: true,
      businesses: { name: "Business", currency: "ZAR" },
    },
  ],
  stores: [
    {
      id: "shop",
      business_id: "business",
      name: "Shop",
      is_active: true,
      location_type: "store",
    },
  ],
  error: false,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: mock.preferred }) }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mock.user } }) },
    rpc: async () => {
      if (mock.error || !mock.ready)
        return { data: null, error: { message: "Database unavailable" } };
      const member = mock.memberships.find((m) => m.user_id === mock.user?.id);
      return {
        error: null,
        data: {
          setup_required: mock.setupRequired,
          has_membership: !!member,
          full_name: "Staff",
          revision: "revision",
          stores: mock.stores.map((s) => ({
            ...s,
            role: member?.role,
            currency: "ZAR",
            business_name: "Business",
            permissions:
              mock.grants.find(
                (g) => g.membership_id === member?.id && g.store_id === s.id,
              )?.permissions ?? null,
          })),
        },
      };
    },
  }),
}));

describe("session location access", () => {
  beforeEach(() => {
    mock.user = { id: "employee", email: "staff@example.test" };
    mock.preferred = "shop";
    mock.error = false;
    mock.ready = true;
    mock.grants = [];
    mock.setupRequired = false;
    mock.stores = [
      {
        id: "shop",
        business_id: "business",
        name: "Shop",
        is_active: true,
        location_type: "store",
      },
    ];
  });
  it("uses only the signed-in member's role even when other business members are readable", async () => {
    expect((await getSession())?.activeStore?.role).toBe("employee");
  });
  it("routes unfinished invited employees to account completion", async () => {
    mock.setupRequired = true;
    await expect(getSession()).rejects.toThrow("NEXT_REDIRECT");
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
    await expect(getSession()).rejects.toThrow(
      "SERVICE_TEMPORARILY_UNAVAILABLE",
    );
  });
  it("returns no session when signed out", async () => {
    mock.user = null;
    expect(await getSession()).toBeNull();
  });
  it("loads only the current user's store grants without borrowing another member's", async () => {
    mock.grants = [
      {
        membership_id: "staff-member",
        store_id: "shop",
        permissions: { goods_out: false },
      },
      {
        membership_id: "owner-member",
        store_id: "shop",
        permissions: { goods_out: true },
      },
    ];
    expect((await getSession())?.activeStore?.modules.goods_out).toBe(false);
  });
  it("fails safely when the running app and database are incompatible", async () => {
    mock.ready = false;
    await expect(getSession()).rejects.toThrow(
      "SERVICE_TEMPORARILY_UNAVAILABLE",
    );
  });
});
