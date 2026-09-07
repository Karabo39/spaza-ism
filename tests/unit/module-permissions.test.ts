import { describe, it, expect } from "vitest";
import { MODULES, modulePermissions, moduleForPath, firstModulePath } from "@/lib/modules";
import { NAV, itemVisible } from "@/components/shell/nav-config";
describe("store module permissions", () => {
  it("preserves role defaults while capping attempted role elevation", () => {
    const p = modulePermissions("employee", { goods_out: false, settings: true });
    expect(p.goods_out).toBe(false); expect(p.goods_in).toBe(true); expect(p.settings).toBe(false);
  });
  it("does not treat string booleans or malformed grants as permission", () => {
    expect(modulePermissions("employee", { goods_out: "false" }).goods_out).toBe(false);
    expect(modulePermissions("employee", null).goods_out).toBe(false);
  });
  it("always keeps owner recovery access", () => {
    expect(Object.values(modulePermissions("owner", Object.fromEntries(MODULES.map((m) => [m.key, false])))).every(Boolean)).toBe(true);
  });
  it("covers every navigation item and nested route", () => {
    for (const i of NAV.flatMap((g) => g.items)) expect(moduleForPath(i.href), i.href).toBeDefined();
    expect(moduleForPath("/invoices/id/receipt?print=1")).toBe("invoices");
    expect(moduleForPath("/reports-unrelated")).toBeUndefined();
    expect(moduleForPath("/no-access")).toBeUndefined();
  });
  it("hides a denied module even when the role qualifies and chooses a safe landing page", () => {
    const p = modulePermissions("manager", Object.fromEntries(MODULES.map((m) => [m.key, m.key === "check_price"])));
    const item = NAV.flatMap((g) => g.items).find((i) => i.href === "/goods-out")!;
    expect(itemVisible(item, "manager", (key) => p[key])).toBe(false);
    expect(firstModulePath(p)).toBe("/check-price");
    expect(firstModulePath(modulePermissions("employee", null))).toBe("/no-access");
  });
});
