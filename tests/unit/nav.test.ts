import { describe, it, expect } from "vitest";
import { itemVisible, NAV } from "@/components/shell/nav-config";

describe("itemVisible (role gating)", () => {
  const adjust = NAV.flatMap((g) => g.items).find((i) => i.href === "/adjust")!;
  const users = NAV.flatMap((g) => g.items).find((i) => i.href === "/users")!;
  const dashboard = NAV.flatMap((g) => g.items).find((i) => i.href === "/")!;

  it("hides manager-only items from employees", () => {
    expect(itemVisible(adjust, "employee")).toBe(false);
    expect(itemVisible(adjust, "manager")).toBe(true);
    expect(itemVisible(adjust, "owner")).toBe(true);
  });

  it("hides owner-only items from managers", () => {
    expect(itemVisible(users, "manager")).toBe(false);
    expect(itemVisible(users, "owner")).toBe(true);
  });

  it("shows unrestricted items to everyone", () => {
    expect(itemVisible(dashboard, "employee")).toBe(true);
  });
});
