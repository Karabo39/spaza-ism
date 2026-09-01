import { describe, it, expect } from "vitest";
import { money, qty, friendlyError } from "@/lib/format";

describe("money", () => {
  it("formats ZAR with two decimals", () => {
    expect(money(1234.5)).toContain("1 234,50"); // en-ZA grouping
    expect(money(0)).toContain("0,00");
  });
  it("handles null/undefined/strings", () => {
    expect(money(null)).toContain("0,00");
    expect(money(undefined)).toContain("0,00");
    expect(money("42.1")).toContain("42,10");
  });
});

describe("qty", () => {
  it("strips trailing zeros", () => {
    expect(qty(10)).toBe("10");
    expect(qty(1.5)).toBe("1.5");
    expect(qty("2.000")).toBe("2");
    expect(qty(0)).toBe("0");
  });
  it("handles invalid input", () => {
    expect(qty(null)).toBe("0");
    expect(qty(undefined)).toBe("0");
  });
});

describe("friendlyError", () => {
  it("maps known RPC errors to human text", () => {
    expect(friendlyError("INSUFFICIENT_STOCK: product x")).toMatch(/not enough stock/i);
    expect(friendlyError("CREDIT_LIMIT_EXCEEDED: ...")).toMatch(/credit limit/i);
    expect(friendlyError("OVERRIDE_NOT_AUTHORIZED")).toMatch(/manager or owner/i);
    expect(friendlyError("FORBIDDEN")).toMatch(/permission/i);
  });
  it("passes through unknown messages", () => {
    expect(friendlyError("some weird error")).toBe("some weird error");
    expect(friendlyError("")).toMatch(/something went wrong/i);
  });
});
