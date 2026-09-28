// @vitest-environment node
import { it, expect, vi } from "vitest";
import {
  recurringHandler,
  type RecurringDelivery,
} from "../../supabase/functions/recurring-invoices/handler";
const secret = "a".repeat(64);
const authenticate = async (value: string) => ({
  data: value === secret,
  error: null,
});
const job = {
  id: "invoice",
  token: "reservation",
  recipient: "customer@example.test",
} as RecurringDelivery;
const request = (authenticated = true) =>
  new Request("https://worker.test", {
    method: "POST",
    headers: authenticated ? { "x-recurring-secret": secret } : {},
  });
it("never claims customer invoices without worker authentication", async () => {
  const claim = vi.fn(),
    send = vi.fn();
  const r = await recurringHandler({
    authenticate,
    configured: true,
    claim,
    send,
    complete: vi.fn(),
  })(request(false));
  expect(r.status).toBe(401);
  expect(claim).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});
it("does not consume deliveries when SMTP is unavailable", async () => {
  const claim = vi.fn();
  const r = await recurringHandler({
    authenticate,
    configured: false,
    claim,
    send: vi.fn(),
    complete: vi.fn(),
  })(request());
  expect(r.status).toBe(503);
  expect(claim).not.toHaveBeenCalled();
});
it("rejects a plausible but incorrect Vault credential", async () => {
  const claim = vi.fn();
  const r = await recurringHandler({
    authenticate: async () => ({ data: false, error: null }),
    configured: true,
    claim,
    send: vi.fn(),
    complete: vi.fn(),
  })(request());
  expect(r.status).toBe(401);
  expect(claim).not.toHaveBeenCalled();
});
it("fails closed if credential verification is unavailable", async () => {
  const claim = vi.fn();
  const r = await recurringHandler({
    authenticate: async () => ({
      data: null,
      error: { message: "unavailable" },
    }),
    configured: true,
    claim,
    send: vi.fn(),
    complete: vi.fn(),
  })(request());
  expect(r.status).toBe(401);
  expect(claim).not.toHaveBeenCalled();
});
it("records an unconfirmed delivery without retrying SMTP", async () => {
  const complete = vi.fn().mockResolvedValue({ error: null }),
    send = vi.fn().mockRejectedValue(new Error("connection lost"));
  const r = await recurringHandler({
    authenticate,
    configured: true,
    claim: async () => ({ data: [job], error: null }),
    send,
    complete,
  })(request());
  expect(r.status).toBe(502);
  expect(send).toHaveBeenCalledTimes(1);
  expect(complete).toHaveBeenCalledWith(job);
});
it("records accepted mail against the same invoice reservation", async () => {
  const complete = vi.fn().mockResolvedValue({ error: null });
  const r = await recurringHandler({
    authenticate,
    configured: true,
    claim: async () => ({ data: [job], error: null }),
    send: async () => ({ id: "accepted" }),
    complete,
  })(request());
  expect(await r.json()).toEqual({ sent: 1, uncertain: 0 });
  expect(complete).toHaveBeenCalledWith(job, "accepted");
});
