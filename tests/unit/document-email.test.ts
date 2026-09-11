// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/documents/email/route";
const m = vi.hoisted(() => ({
  session: vi.fn(),
  rpc: vi.fn(),
  load: vi.fn(),
  fetch: vi.fn(),
  file: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ getSession: m.session }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({ rpc: m.rpc }),
}));
vi.mock("@/features/billing/document-email", () => ({
  loadEmailDocument: m.load,
}));
vi.mock("@/features/reports/export-data", () => ({ reportFile: m.file }));
vi.mock("@/lib/email", () => ({
  emailConfigured: () => !!process.env.SMTP_PASSWORD,
  sendEmail: (...args: unknown[]) => m.fetch(...args),
}));
const id = "00000000-0000-4000-8000-000000000001";
function request(extra = {}, origin = "https://pos.test") {
  return new Request("https://pos.test/api/documents/email", {
    method: "POST",
    headers: { origin },
    body: JSON.stringify({
      type: "invoice",
      id,
      recipient: "buyer@example.test",
      requestId: id,
      ...extra,
    }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  m.session.mockResolvedValue({
    activeStore: {
      id,
      name: "Shop",
      businessName: "Company",
      currency: "USD",
      modules: {
        invoices: true,
        invoices_view_invoices: true,
        returns: true,
        reports: false,
      },
    },
  });
  m.load.mockResolvedValue({
    recipient: "saved@example.test",
    reference: "INV-123",
    data: {
      title: "Invoice INV-123",
      columns: [{ key: "amount", label: "Amount" }],
      rows: [{ amount: 100 }],
    },
  });
  m.rpc.mockImplementation((name) =>
    Promise.resolve(
      name === "prepare_document_email"
        ? {
            data: {
              id: "job",
              sent: false,
              created_at: "2026-09-10T10:00:00Z",
            },
            error: null,
          }
        : { error: null },
    ),
  );
  m.file.mockResolvedValue(new Blob(["pdf"]));
  vi.stubEnv("SMTP_PASSWORD", "test-key");
  vi.stubEnv("REPORT_EMAIL_FROM", "sender@example.test");
  vi.stubEnv("INVOICE_EMAIL_FROM", "");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("prefills the saved customer email without sending", async () => {
  const r = await GET(
    new Request(`https://pos.test/api/documents/email?type=invoice&id=${id}`),
  );
  expect(await r.json()).toMatchObject({
    recipient: "saved@example.test",
    configured: true,
  });
  expect(m.fetch).not.toHaveBeenCalled();
});
it("rejects wrong module and inaccessible documents", async () => {
  m.session.mockResolvedValueOnce({
    activeStore: { id, modules: { invoices: false } },
  });
  expect((await POST(request())).status).toBe(403);
  m.load.mockResolvedValueOnce(null);
  expect((await POST(request())).status).toBe(404);
  expect(m.fetch).not.toHaveBeenCalled();
});
it("checks origin and email format", async () => {
  expect((await POST(request({}, "https://evil.test"))).status).toBe(403);
  expect((await POST(request({ recipient: "bad" }))).status).toBe(400);
  expect(m.load).not.toHaveBeenCalled();
});
it("does not send when the sender is unconfigured", async () => {
  vi.stubEnv("SMTP_PASSWORD", "");
  expect((await POST(request())).status).toBe(503);
  expect(m.fetch).not.toHaveBeenCalled();
});
it("uses authoritative document data and stable provider retries", async () => {
  m.fetch
    .mockRejectedValueOnce(new Error("network"))
    .mockResolvedValueOnce({ id: "provider" });
  expect((await POST(request({ rows: [{ amount: 1 }] }))).status).toBe(502);
  expect((await POST(request({ rows: [{ amount: 1 }] }))).status).toBe(200);
  expect(m.file.mock.calls[0][0].rows).toEqual([{ amount: 100 }]);
  expect(m.fetch.mock.calls.map((c) => c[1])).toEqual([
    "document-job",
    "document-job",
  ]);
  expect(m.rpc).toHaveBeenCalledWith("complete_report_email", {
    p_job: "job",
    p_provider: "provider",
  });
});
it("does not send a completed job again", async () => {
  m.rpc.mockResolvedValue({ data: { id: "job", sent: true }, error: null });
  expect((await POST(request())).status).toBe(200);
  expect(m.fetch).not.toHaveBeenCalled();
});
it("uses the invoice sender for documents independently of the report sender", async () => {
  vi.stubEnv(
    "INVOICE_EMAIL_FROM",
    "POS INVENTORY <invoice@posinventory.store>",
  );
  vi.stubEnv("REPORT_EMAIL_FROM", "");
  m.fetch.mockResolvedValue({ id: "provider" });
  const preview = await GET(
    new Request(`https://pos.test/api/documents/email?type=invoice&id=${id}`),
  );
  expect(await preview.json()).toMatchObject({ configured: true });
  expect((await POST(request())).status).toBe(200);
  expect(m.fetch.mock.calls[0][2].from).toBe(
    "POS INVENTORY <invoice@posinventory.store>",
  );
});
it("keeps the existing sender as a fallback for return receipts", async () => {
  vi.stubEnv("INVOICE_EMAIL_FROM", "   ");
  m.fetch.mockResolvedValue({ id: "provider" });
  expect((await POST(request({ type: "return" }))).status).toBe(200);
  expect(m.fetch.mock.calls[0][2].from).toBe("sender@example.test");
});
