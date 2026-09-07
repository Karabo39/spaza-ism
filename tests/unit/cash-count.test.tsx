import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CashCount } from "@/features/cash-up/cash-up-console";
import { amountCents, denominationCents } from "@/features/cash-up/cash-utils";
import type { CashSummary } from "@/features/cash-up/types";
vi.mock("@/lib/store-context", () => ({ useStore: () => ({ currency: "ZAR" }) }));
const data = { expected: 10.30, count_token: "version1" } as CashSummary;
describe("cash count", () => {
  beforeEach(cleanup);
  it("counts exact cents and rejects fractional notes, scientific notation and excessive decimals", () => {
    expect(amountCents("10.30")).toBe(1030); expect(amountCents("1.001")).toBeNull(); expect(amountCents("1e3")).toBeNull();
    expect(denominationCents({ "10": "1", "0.2": "1", "0.1": "1" })).toBe(1030);
    expect(denominationCents({ "10": "1.5" })).toBeNull(); expect(denominationCents({ "3": "1" })).toBeNull();
  });
  it("requires a note for a variance and reuses a request on an uncertain retry", () => {
    const submit = vi.fn().mockResolvedValue(undefined); render(<CashCount data={data} disabled={false} busy={false} onSubmit={submit} />);
    fireEvent.change(screen.getByLabelText("Cash counted (ZAR)"), { target: { value: "10" } });
    expect(screen.getByRole("button", { name: "Submit for approval" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: /^Count note / }), { target: { value: "30 cents short" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit for approval" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit for approval" }));
    expect(submit).toHaveBeenCalledTimes(2); expect(submit.mock.calls[0][3]).toBe(submit.mock.calls[1][3]);
    expect(submit.mock.calls[0].slice(0, 3)).toEqual([10, {}, "30 cents short"]);
  });
  it("prevents offline or unsynced submission", () => {
    const submit = vi.fn(); render(<CashCount data={data} disabled busy={false} onSubmit={submit} />);
    expect(screen.getByRole("button", { name: "Submit for approval" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Submit for approval" })); expect(submit).not.toHaveBeenCalled();
  });
});
