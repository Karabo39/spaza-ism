import { describe, expect, it } from "vitest";
import { validReturnReasons, returnReasonText } from "@/features/billing/return-reasons";
describe("configured return reasons", () => {
  it("rejects ambiguous or duplicate categories", () => {
    expect(validReturnReasons(["Damaged", "damaged"])).toBe(false);
    expect(validReturnReasons(["Damaged: broken"])).toBe(false);
    expect(validReturnReasons([])).toBe(false);
    expect(validReturnReasons(["Faulty", "Other"])).toBe(true);
  });
  it("keeps the configured category separate from the explanation", () => {
    expect(returnReasonText("Other", "  Incorrect size  ")).toBe(
      "Other: Incorrect size",
    );
    expect(returnReasonText("Damaged", " ")).toBe("Damaged");
  });
});
