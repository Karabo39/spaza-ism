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

describe("child permissions",()=>{
 it("requires parent and destination while retaining role limits",()=>{
  expect(modulePermissions("employee",{orders:false,orders_new:true}).orders_new).toBe(false);
  expect(modulePermissions("employee",{dashboard:true,dashboard_check_stock:true,check_stock:false}).dashboard_check_stock).toBe(false);
  expect(modulePermissions("employee",{dashboard_adjust:true}).dashboard_adjust).toBe(false);
  expect(modulePermissions("employee",{invoices_summary:false,invoices_outstanding:true}).invoices_outstanding).toBe(false);
 });
 it("preserves legacy defaults and independently denies children",()=>{
  const p=modulePermissions("employee",{orders_new:false,invoices_paid:false});
  expect(p.orders_new).toBe(false);expect(p.orders_recent).toBe(true);
  expect(p.invoices_paid).toBe(false);expect(p.invoices_outstanding).toBe(true);
 });
});
