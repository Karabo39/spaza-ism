import { beforeEach, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { InvoiceWorkspace } from "@/features/billing/invoice-workspace";
import type { InvoiceBalance } from "@/lib/db/database.types";
const mocks = vi.hoisted(() => ({
  manager: false,
  rpc: vi.fn().mockResolvedValue({ error: null }),
  run: vi.fn(),
  online: true,
}));
vi.mock("@/lib/store-context", () => ({
  useStore: () => ({ can: () => mocks.manager }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/features/billing/use-billing-action", () => ({
  useBillingAction: () => ({
    online: mocks.online,
    busy: false,
    request: () => "request",
    run: mocks.run,
  }),
}));
vi.mock("@/features/reports/export-button", () => ({
  ExportButton: () => null,
}));
vi.mock("@/features/billing/allocate-credit", () => ({
  AllocateCredit: () => null,
}));
vi.mock("@/features/credit/override-approval", () => ({
  OverrideApproval: () => null,
}));
const invoice = {
  id: "invoice",
  state: "ISSUED",
  status: "PAID",
  terms: "CASH",
  total: 10,
  paid: 10,
  credits: 0,
  outstanding: 0,
  currency: "ZAR",
  due_date: "2026-09-07",
  goods_issued_at: "2026-09-07T10:00:00Z",
} as InvoiceBalance;
function show(overrides: Partial<InvoiceBalance> = {}) {
  return render(
    <InvoiceWorkspace
      invoice={{ ...invoice, ...overrides }}
      items={[]}
      entries={[]}
      account={{ balance: 0, credit_limit: 100 }}
    />,
  );
}
beforeEach(() => {
  cleanup();
  mocks.manager = false;
  mocks.online = true;
  mocks.run.mockClear();
});
it("removes payment entry once paid, before or after collection", () => {
  const view = show({ goods_issued_at: null });
  expect(
    screen.queryByRole("button", { name: "Record payment" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Release invoice goods" }),
  ).toBeEnabled();
  view.unmount();
  show();
  expect(screen.getByText("Fully paid")).toBeInTheDocument();
  expect(screen.queryByLabelText("Amount")).not.toBeInTheDocument();
});
it("preserves credit payments after goods release and caps payment at the balance", () => {
  show({ terms: "CREDIT", status: "PARTIALLY_PAID", outstanding: 6, paid: 4 });
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "7" } });
  expect(screen.getByRole("button", { name: "Record payment" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "6" } });
  expect(screen.getByRole("button", { name: "Record payment" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Record payment" }));
  expect(mocks.run).toHaveBeenCalledTimes(1);
});
it("keeps manager adjustments separate and prevents payments through that form", () => {
  mocks.manager = true;
  show();
  fireEvent.click(screen.getByRole("button", { name: "Make adjustment" }));
  expect(
    screen.getByRole("option", { name: "Payment received" }),
  ).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
  expect(screen.getByRole("button", { name: "Post note" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Reason (required)"), {
    target: { value: "Approved correction" },
  });
  expect(screen.getByRole("button", { name: "Post note" })).toBeEnabled();
});
it("blocks offline payments and amounts with fractions of a cent", () => {
  mocks.online = false;
  show({ outstanding: 6, status: "PARTIALLY_PAID" });
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "2" } });
  expect(screen.getByRole("button", { name: "Record payment" })).toBeDisabled();
  cleanup();
  mocks.online = true;
  show({ outstanding: 6 });
  fireEvent.change(screen.getByLabelText("Amount"), {
    target: { value: "2.001" },
  });
  expect(screen.getByRole("button", { name: "Record payment" })).toBeDisabled();
});
