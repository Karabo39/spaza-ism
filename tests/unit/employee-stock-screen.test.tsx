import { beforeEach, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import CheckStockPage from "@/app/(app)/check-stock/page";
const m = vi.hoisted(() => ({ role: "employee", exportRows: [] as Record<string, unknown>[] }));
vi.mock("@/lib/session", () => ({ getSession: async () => ({ activeStore: { id: "store", role: m.role, currency: "ZAR" } }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: async () => ({ data: { rows: [{ id: "p", name: "Coffee", category_name: "Beverages", cost_price: 1234, stock_value: 2468, selling_price: 1600, quantity: 2, unit: "each", stock_status: "ok", is_active: true }], next: null }, error: null }) }) }));
vi.mock("@/components/shell/page-header", () => ({ PageHeader: () => <h1>Check Stock</h1> }));
vi.mock("@/components/shell/toolbar-search", () => ({ ToolbarSearch: () => null }));
vi.mock("@/components/ui/cursor-pagination", () => ({ CursorPagination: () => null }));
vi.mock("@/features/stock/stock-export", () => ({ StockExport: ({ currentRows }: { currentRows: Record<string, unknown>[] }) => { m.exportRows = currentRows; return null; } }));
beforeEach(() => { cleanup(); m.role = "employee"; });
it("shows only the requested employee columns and strips costs from export props", async () => {
  render(await CheckStockPage({ searchParams: Promise.resolve({}) }));
  expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Product", "In stock", "Status", "Selling"]);
  expect(m.exportRows[0]).not.toHaveProperty("cost_price");
  expect(m.exportRows[0]).not.toHaveProperty("stock_value");
  expect(screen.queryByText("Beverages")).toBeNull();
});
it("preserves manager cost columns", async () => {
  m.role = "manager";
  render(await CheckStockPage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByRole("columnheader", { name: /^Cost$/ })).toBeVisible();
  expect(screen.getByRole("columnheader", { name: "Stock value" })).toBeVisible();
  expect(m.exportRows[0]).toHaveProperty("cost_price", 1234);
});
