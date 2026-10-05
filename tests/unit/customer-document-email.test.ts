// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import {
  customerEmail,
  customerPdf,
  type CustomerDocument,
} from "../../supabase/functions/_shared/customer-document";
import {
  customerNotificationHandler,
  type CustomerJob,
} from "../../supabase/functions/customer-notifications/handler";
const doc: CustomerDocument = {
  type: "Invoice",
  business: "Test business",
  customer: "Alex Customer",
  store: "Main shop",
  reference: "INV-20260929-001",
  related_reference: "ORD-001",
  date: "2026-09-29",
  due: "2026-10-29",
  currency: "ZAR",
  summary: "Your order",
  total: 120,
  outstanding: 20,
  payment_status: "Part paid",
  lines: [{ description: "Item", quantity: 2, price: 60, amount: 120 }],
};
it("uses every required dynamic field in HTML and plain text", () => {
  const email = customerEmail(doc);
  for (const value of [
    "Alex Customer",
    "Test business",
    "Invoice",
    "INV-20260929-001",
    "ORD-001",
    "2026-09-29",
    "2026-10-29",
    "Main shop",
    "Your order",
    "ZAR 120,00",
    "ZAR 20,00",
    "Part paid",
  ]) {
    expect(email.text).toContain(value);
    expect(email.html).toContain(value);
  }
});
it("escapes injected HTML and strips subject header control characters", () => {
  const email = customerEmail({
    ...doc,
    customer: '<img src=x onerror="alert(1)">',
    business: "Shop\r\nBcc: private",
    summary: "<script>alert(1)</script>",
  });
  expect(email.html).not.toContain("<script>");
  expect(email.html).not.toContain("<img");
  expect(email.html).toContain("&lt;img");
  expect(email.subject).not.toMatch(/[\r\n]/);
});
it("omits irrelevant due dates and outstanding fields", () => {
  const email = customerEmail({
    ...doc,
    type: "Return / credit note",
    due: null,
    outstanding: null,
  });
  expect(email.text).not.toContain("Payment due date");
  expect(email.text).not.toContain("Outstanding amount");
  expect(email.subject).toContain("Return / credit note");
});
it("renders all statement rows across PDF pages without clipping a long note", () => {
  const pdf = new jsPDF();
  const content = customerPdf(
    {
      ...doc,
      type: "Customer statement",
      details: {
        "Opening balance": 0,
        "Closing balance": 120,
        Comments: "A detailed comment. ".repeat(200),
      },
      lines: Array.from({ length: 120 }, (_, i) => ({
        description: `Entry ${i + 1}`,
        amount: 1,
        balance: i + 1,
      })),
    },
    pdf,
    autoTable,
  );
  expect(Buffer.from(content, "base64").subarray(0, 4).toString()).toBe("%PDF");
  const text = pdf.output();
  expect(text).toContain("Entry 120");
  expect(pdf.getNumberOfPages()).toBeGreaterThan(3);
  expect(text).toContain(
    `Page ${pdf.getNumberOfPages()} of ${pdf.getNumberOfPages()}`,
  );
});
describe("customer document worker", () => {
  const job: CustomerJob = {
    id: "job",
    token: "token",
    recipient: "customer@example.test",
    document: doc,
  };
  const secret = "a".repeat(64);
  const request = (key = secret) =>
    new Request("https://worker.example.test", {
      method: "POST",
      headers: { "x-recurring-secret": key },
    });
  function deps() {
    return {
      configured: true,
      authenticate: vi.fn(async (key: string) => ({
        data: key === secret,
        error: null,
      })),
      claim: vi.fn(async () => ({ data: [job], error: null })),
      prepare: vi.fn(async () => "pdf"),
      send: vi.fn(async () => ({ id: "smtp-accepted" })),
      complete: vi.fn(async () => ({ error: null })),
    };
  }
  it("rejects missing and wrong credentials before claiming", async () => {
    const d = deps();
    expect((await customerNotificationHandler(d)(request(""))).status).toBe(
      401,
    );
    expect(
      (await customerNotificationHandler(d)(request("b".repeat(64)))).status,
    ).toBe(401);
    expect(d.claim).not.toHaveBeenCalled();
  });
  it("does not consume jobs with incomplete SMTP configuration", async () => {
    const d = deps();
    d.configured = false;
    expect((await customerNotificationHandler(d)(request())).status).toBe(503);
    expect(d.claim).not.toHaveBeenCalled();
  });
  it("retries preparation failures without attempting SMTP", async () => {
    const d = deps();
    d.prepare.mockRejectedValue(new Error("PDF error"));
    expect((await customerNotificationHandler(d)(request())).status).toBe(502);
    expect(d.send).not.toHaveBeenCalled();
    expect(d.complete).toHaveBeenCalledWith(job, "PREPARATION_FAILED");
  });
  it("records uncertain SMTP separately from safe preparation retries", async () => {
    const d = deps();
    d.send.mockRejectedValue(
      new Error("Provider response includes private data"),
    );
    const response = await customerNotificationHandler(d)(request());
    expect(d.complete).toHaveBeenCalledWith(job, "UNCERTAIN");
    expect(await response.text()).not.toContain("private data");
  });
  it("sends the generated PDF and records the matching reservation", async () => {
    const d = deps();
    const response = await customerNotificationHandler(d)(request());
    expect(d.send).toHaveBeenCalledWith(job, "pdf");
    expect(d.complete).toHaveBeenCalledWith(job, "SENT", "smtp-accepted");
    expect(await response.json()).toEqual({ sent: 1, failed: 0 });
  });
});

it("includes safe private and courier tracking links and rejects executable URLs", () => {
  const email = customerEmail({
    ...doc,
    tracking_url: "https://posinventory.shop/shop/link/track/order#private",
    courier_tracking_url: "https://courier.test/track?a=1&b=2",
  });
  expect(email.html).toContain(
    'href="https://posinventory.shop/shop/link/track/order#private"',
  );
  expect(email.html).toContain('href="https://courier.test/track?a=1&amp;b=2"');
  expect(
    customerEmail({ ...doc, tracking_url: "javascript:alert(1)" }).html,
  ).not.toContain("javascript:");
});
