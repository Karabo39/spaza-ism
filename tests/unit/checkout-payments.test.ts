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

it("combines card and EFT while preserving legacy split drafts", () => {
  const draft = {
    ...emptyPayments,
    cash: "50",
    card: "70",
    eft: "500",
    cardConfirmed: true,
    eftConfirmed: true,
  };
  expect(paymentSummary("SPLIT_COMBINED", draft, 100)).toMatchObject({
    valid: true,
    change: 20,
    payments: [
      { method: "CASH", amount: 50 },
      { method: "CARD_EFT", amount: 70 },
    ],
  });
  expect(
    paymentSummary("CARD_EFT", { ...draft, cardConfirmed: false }, 70).valid,
  ).toBe(false);
  expect(paymentSummary("CARD_EFT", draft, 60).valid).toBe(false);
  expect(
    paymentSummary(
      "SPLIT",
      { ...draft, eft: "10", card: "40" },
      100,
    ).payments.map((p) => p.method),
  ).toEqual(["CASH", "CARD", "EFT"]);
});
