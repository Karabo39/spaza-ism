import { beforeEach, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within, fireEvent } from "@testing-library/react";
import { money } from "@/lib/format";
import type { CashSummary } from "@/features/cash-up/types";
import { businessDate } from "@/lib/business-date";
import { CashUpConsole } from "@/features/cash-up/cash-up-console";
const m = vi.hoisted(() => ({
  manager: true,
  data: {
    session: null,
    expected: 286,
    count_token: "token",
    changed_since_count: false,
    history: [],
    movements: [],
    sources: {
      sales: 286,
      invoices: 0,
      credit: 0,
      refunds: 0,
      added: 0,
      removed: 0,
      net: 286,
      fingerprint: "test",
      unclassified: [],
      activity: {
        cash_sales: 286,
        card_sales: 0,
        total_sales: 1054,
        invoice_payments: 768,
        credit_payments: 0,
        credit_issued: 0,
        refunds: 0,
        net_collected: 1054,
      },
    },
  } as CashSummary,
}));
vi.mock("@/lib/store-context", () => ({
  useStore: () => ({
    store: { id: "shop", name: "Midtown Store", locationType: "store" },
    currency: "ZAR",
    can: () => m.manager,
  }),
}));
vi.mock("@/lib/offline/offline-context", () => ({
  useOffline: () => ({
    online: true,
    pending: 0,
    failed: 0,
    syncing: false,
    syncNow: vi.fn(),
  }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: queryKey[0] === "cash-up" ? m.data : [],
    refetch: vi.fn(),
  }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
beforeEach(() => {
  cleanup();
  m.manager = true;
  m.data.session = null;
  m.data.shifts = undefined;
  m.data.history = [];
});
it("keeps sale totals separate from collected cash and opening cash", () => {
  render(<CashUpConsole />);
  const cards = screen.getByRole("region", { name: "Shift totals" });
  expect(
    within(cards).getByText("Total Sales").nextElementSibling?.textContent,
  ).toBe(money(1054, "ZAR"));
  expect(screen.getByRole("heading", { name: "Cash Summary" })).toBeVisible();
  expect(
    screen.getByRole("heading", { name: "Start first shift" }),
  ).toBeVisible();
  expect(
    screen.getByText("Cash Drawer Management").closest("details"),
  ).not.toHaveAttribute("open");
});
it("does not expose manager drawer tools to a cashier", () => {
  m.manager = false;
  render(<CashUpConsole />);
  expect(screen.queryByText("Cash Drawer Management")).toBeNull();
  expect(screen.queryByRole("button", { name: "Record movement" })).toBeNull();
  expect(
    screen.getByRole("button", { name: "Start first shift" }),
  ).toBeVisible();
});

it("places next shift directly below approval in the same column and keeps shift selectors clickable", () => {
 const now = new Date().toISOString();
 m.data.session = { id: "shift", business_date: businessDate(), opening_float: 100, status: "APPROVED", version: 1, latest_submission: "count", shift_number: 1 };
 m.data.shifts = [{ id: "shift", shift_number: 1, status: "APPROVED", created_by_name: "Cashier", created_at: now, opening_float: 100 }];
 m.data.history = [{ id: "count", revision: 1, counted: 286, expected: 286, variance: 0, note: null, created_at: now, created_by_name: "Cashier", reviews: [] }];
 render(<CashUpConsole />);
 const approved = screen.getByRole("heading", { name: "Cash-up approved" }).closest("section")!;
 const next = screen.getByRole("heading", { name: "Start next shift" }).closest("section")!;
 expect(approved.nextElementSibling).toBe(next);
 expect(approved.parentElement).toBe(next.parentElement);
 const shift = screen.getByRole("button", { name: /Shift 1.*Cashier/ });
 const latest = screen.getByRole("button", { name: "Latest shift" });
 expect(shift).toHaveClass("bg-emerald-500");
 expect(latest).toHaveClass("bg-emerald-500");
 fireEvent.click(shift);
 expect(latest).toHaveAttribute("aria-pressed", "false");
 fireEvent.click(latest);
 expect(latest).toHaveAttribute("aria-pressed", "true");
});
