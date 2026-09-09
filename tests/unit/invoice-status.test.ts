import { expect, it } from "vitest";
import { invoiceStatusLabel } from "@/features/billing/status-label";
it("distinguishes fully paid undelivered invoices from delivered and credited invoices", () => {
  expect(invoiceStatusLabel({ status: "PAID", goods_issued_at: null })).toBe(
    "Paid – To be Delivered",
  );
  expect(
    invoiceStatusLabel({
      status: "PAID",
      goods_issued_at: "2026-09-09T12:00:00Z",
    }),
  ).toBe("Paid");
  expect(
    invoiceStatusLabel({ status: "PARTIALLY_PAID", goods_issued_at: null }),
  ).toBe("Partially paid");
  expect(
    invoiceStatusLabel({ status: "CREDITED", goods_issued_at: null }),
  ).toBe("Credited");
});
