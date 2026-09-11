import { describe, it, expect, vi } from "vitest";
import { matchesRelease, databaseReady } from "@/lib/release-status";
import { safeErrorEvent } from "@/lib/operational-errors";

describe("release safeguards", () => {
  it("rejects missing, partial and future-incompatible contracts", () => {
    expect(matchesRelease(null)).toBe(false);
    expect(matchesRelease({ version: 1, capabilities: { brd_v102: true } })).toBe(false);
    expect(matchesRelease({ version: 2, capabilities: { brd_v102: true, module_access_v1: true, cash_up_v1: true, order_workflow_v1: true, document_workflows_v1: true, employee_invitations_v1: true, cash_shifts_v1: true, store_currency_v1:true, document_email_v1:true, product_description_v1:true, detailed_permissions_v1:true, invoice_refinements_v1: true, batch_expiry_v1: true } })).toBe(false);
    expect(matchesRelease({ version: 1, capabilities: { brd_v102: true, module_access_v1: true, cash_up_v1: true, order_workflow_v1: true, document_workflows_v1: true, employee_invitations_v1: true, cash_shifts_v1: true, store_currency_v1:true, document_email_v1:true, product_description_v1:true, detailed_permissions_v1:true, invoice_refinements_v1: true, batch_expiry_v1: true } })).toBe(true);
  });
  it("fails closed for a database outage", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
    try { expect(await databaseReady(vi.fn().mockRejectedValue(new Error("network")))).toBe(false); }
    finally { vi.unstubAllEnvs(); }
  });
  it("does not report raw errors, stack traces or request query values", () => {
    const event = safeErrorEvent({ message: "private@example.test password=secret", stack: "private-stack", digest: "123", code: "42703" }, "/invoices/[id]?token=secret");
    expect(event.route).toBe("/invoices/[id]");
    expect(JSON.stringify(event)).not.toMatch(/secret|private|stack|password/);
    expect(event.code).toBe("42703");
  });
});
