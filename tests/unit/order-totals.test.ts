import { expect, it } from "vitest";
import { orderTotals } from "@/features/billing/order-totals";
it("previews tax after discount and rounded invoice lines", () => {
  expect(orderTotals([{ quantity: 10, unit_price: 10 }], 10, 15)).toEqual({
    subtotal: 100,
    discount: 10,
    tax: 13.5,
    total: 103.5,
    valid: true,
  });
  expect(orderTotals([{ quantity: 1.005, unit_price: 3 }], 0, 0).subtotal).toBe(
    3.02,
  );
});
it("rejects discounts beyond the order subtotal", () => {
  expect(orderTotals([{ quantity: 1, unit_price: 10 }], 11, 15).valid).toBe(
    false,
  );
  expect(orderTotals([], Number.NaN, 0).valid).toBe(false);
});
