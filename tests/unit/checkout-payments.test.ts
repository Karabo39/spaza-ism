import { describe, expect, it } from "vitest";
import { emptyPayments, paymentSummary } from "@/features/goods-out/payments";
describe("checkout payments", () => {
  it("separates cash tender and change from the sale total", () => {
    const result = paymentSummary(
      "SPLIT",
      {
        ...emptyPayments,
        cash: "50",
        card: "40",
        eft: "30",
        cardConfirmed: true,
        eftConfirmed: true,
      },
      100,
    );
    expect(result.valid).toBe(true);
    expect(result.change).toBe(20);
    expect(result.remaining).toBe(0);
  });
  it("blocks underpayments and unconfirmed external payments", () => {
    expect(
      paymentSummary("CASH", { ...emptyPayments, cash: "99.99" }, 100).valid,
    ).toBe(false);
    expect(
      paymentSummary("CARD", { ...emptyPayments, card: "100" }, 100).valid,
    ).toBe(false);
  });
  it.each(["-1", "Infinity", "NaN", "100.001", "1e3"])(
    "rejects invalid amount %s",
    (cash) => {
      expect(
        paymentSummary("CASH", { ...emptyPayments, cash }, 100).valid,
      ).toBe(false);
    },
  );
  it("rejects noncash overpayment and unnecessary cash", () => {
    expect(
      paymentSummary(
        "CARD",
        { ...emptyPayments, card: "101", cardConfirmed: true },
        100,
      ).valid,
    ).toBe(false);
    expect(
      paymentSummary(
        "SPLIT",
        { ...emptyPayments, cash: "1", card: "100", cardConfirmed: true },
        100,
      ).valid,
    ).toBe(false);
  });
  it("handles exact decimal totals and ignores payments from inactive modes", () => {
    expect(
      paymentSummary(
        "CASH",
        { ...emptyPayments, cash: "0.30", card: "100" },
        0.1 + 0.2,
      ),
    ).toMatchObject({ valid: true, remaining: 0, change: 0 });
    expect(
      paymentSummary("CREDIT", { ...emptyPayments, cash: "100" }, 100).payments,
    ).toEqual([]);
  });
});
