import { beforeEach, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { money } from "@/lib/format";
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
  },
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
