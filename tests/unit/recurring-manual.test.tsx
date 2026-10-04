import { beforeEach, it, expect, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { RecurringInvoices } from "@/features/billing/recurring-invoices";
const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  schedule: {
    id: "schedule",
    title: "Monthly support",
    customer_id: "customer",
    frequency: "MONTHLY",
    start_date: "2026-09-28",
    next_date: "2026-10-28",
    send_time: "14:35:00",
    due_days: 30,
    terms: "CASH",
    tax_percent: 15,
    recipient: "buyer@example.test",
    active: true,
    auto_email: true,
    version: 3,
    items: [
      { product_id: "product", name: "Support", quantity: 1, unit_price: 100 },
    ],
  },
}));
vi.mock("@/lib/store-context", () => ({
  useStore: () => ({
    store: { id: "shop", businessId: "business" },
    currency: "ZAR",
  }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: m.rpc }),
}));
vi.mock("@/features/credit/customer-picker", () => ({
  CustomerPicker: () => null,
}));
vi.mock("@/features/operations/product-picker", () => ({
  LocationProductPicker: () => null,
}));
vi.mock("@/features/billing/use-billing-action", () => ({
  useBillingAction: () => ({
    online: true,
    busy: false,
    run: async (
      fn: () => Promise<unknown>,
      _message: string,
      done?: () => void,
    ) => {
      await fn();
      done?.();
    },
  }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data:
      queryKey[1] === "recurring"
        ? [m.schedule]
        : queryKey[1] === "recurring-customer"
          ? {
              name: "Buyer",
              email: "buyer@example.test",
              credit_enabled: false,
            }
          : queryKey[1] === "recurring-timezone"
            ? "Africa/Johannesburg"
            : 15,
    isLoading: false,
    error: null,
  }),
}));
beforeEach(() => {
  cleanup();
  m.rpc.mockReset().mockResolvedValue({ data: "invoice", error: null });
});
it("reviews an additional invoice and permits editing without sending", () => {
  render(<RecurringInvoices />);
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  expect(screen.getByLabelText("Send Time")).toHaveValue("14:35");
  fireEvent.click(screen.getByRole("button", { name: "Manual Send" }));
  expect(screen.getByRole("dialog")).toHaveTextContent(
    "Your next automatic invoice remains unchanged",
  );
  expect(screen.getByRole("dialog")).toHaveTextContent("buyer@example.test");
  expect(m.rpc).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("dialog").querySelector("button")!);
  expect(m.rpc).not.toHaveBeenCalled();
});
it("only creates and queues the additional invoice after confirmation", async () => {
  render(<RecurringInvoices />);
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  fireEvent.click(screen.getByRole("button", { name: "Manual Send" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm and send the Invoice" }),
  );
  await waitFor(() => expect(m.rpc).toHaveBeenCalledOnce());
  expect(m.rpc.mock.calls[0][0]).toBe("send_manual_recurring_invoice");
  expect(m.rpc.mock.calls[0][1]).toMatchObject({
    p_id: "schedule",
    p_expected: 3,
    p_details: {
      next_date: "2026-10-28",
      send_time: "14:35",
      recipient: "buyer@example.test",
    },
  });
});

it("requires an inactive schedule and confirmation before permanent deletion", async () => {
  m.schedule.active = true;
  const view = render(<RecurringInvoices />);
  expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  view.unmount();
  m.schedule.active = false;
  render(<RecurringInvoices />);
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  expect(m.rpc).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toHaveTextContent(
    "Previously generated invoices",
  );
  fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
  await waitFor(() =>
    expect(m.rpc).toHaveBeenCalledWith("delete_recurring_invoice", {
      p_id: "schedule",
      p_expected: 3,
    }),
  );
  m.schedule.active = true;
});
