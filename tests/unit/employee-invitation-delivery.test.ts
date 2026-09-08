import { expect, it, vi } from "vitest";
import { invitationHandler } from "../../supabase/functions/employee-invitations/handler";
function fixture() {
  const delivery = {
    id: "10000000-0000-4000-8000-000000000001",
    email: "employee@test.invalid",
    business: "Shop",
    existing: false,
    secret: "a".repeat(64),
    version: 2,
    expires_at: "2026-10-01T00:00:00Z",
  };
  const deps = {
    configured: true,
    appUrl: "https://posinventory.shop",
    authenticate: vi.fn(async () => "owner" as string | null),
    prepare: vi.fn(async () => delivery),
    link: vi.fn(async () => ({
      userId: "employee",
      tokenHash: "private-auth-token",
      type: "invite",
    })),
    send: vi.fn(async () => {}),
    finish: vi.fn(async () => {}),
  };
  const request = () =>
    new Request(
      "https://project.supabase.co/functions/v1/employee-invitations",
      {
        method: "POST",
        headers: { Authorization: "Bearer session" },
        body: JSON.stringify({ invitationId: delivery.id, version: 1 }),
      },
    );
  return { deps, request, delivery };
}
it("does not prepare or send invitations without authenticated authorization", async () => {
  const { deps, request } = fixture();
  deps.authenticate.mockResolvedValue(null);
  expect((await invitationHandler(deps)(request())).status).toBe(401);
  expect(deps.prepare).not.toHaveBeenCalled();
  expect(deps.send).not.toHaveBeenCalled();
});
it("keeps missing sender configuration clearly unsent", async () => {
  const { deps, request } = fixture();
  deps.configured = false;
  const response = await invitationHandler(deps)(request());
  expect(response.status).toBe(503);
  expect(await response.text()).toContain("has not been sent");
  expect(deps.prepare).not.toHaveBeenCalled();
});
it("sends a private fragment link but never returns the login token to the owner", async () => {
  const { deps, request, delivery } = fixture();
  const response = await invitationHandler(deps)(request());
  expect(response.status).toBe(200);
  expect(deps.send).toHaveBeenCalledWith(
    delivery.email,
    expect.stringContaining("Shop"),
    expect.stringContaining("/accept-invitation#"),
    `employee-invitation-${delivery.id}-2`,
  );
  const body = await response.text();
  expect(body).not.toContain("private-auth-token");
  expect(body).not.toContain(delivery.secret);
  expect(deps.finish).toHaveBeenCalledWith(delivery, "employee", true);
});
it("rejects a stale resend without generating a login link", async () => {
  const { deps, request } = fixture();
  deps.prepare.mockRejectedValue(new Error("INVITATION_CHANGED"));
  expect((await invitationHandler(deps)(request())).status).toBe(409);
  expect(deps.link).not.toHaveBeenCalled();
});
it("handles interrupted delivery without claiming success or leaking provider details", async () => {
  const { deps, request, delivery } = fixture();
  deps.send.mockRejectedValue(new Error("private provider credentials"));
  const response = await invitationHandler(deps)(request());
  expect(response.status).toBe(502);
  expect(await response.text()).not.toContain("credentials");
  expect(deps.finish).toHaveBeenCalledWith(delivery, "employee", false);
});
