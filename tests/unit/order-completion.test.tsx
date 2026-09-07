import { beforeEach, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { OrdersConsole } from "@/features/billing/orders-console";
const mocks = vi.hoisted(() => ({ invoices: true, status: "COMPLETED" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/store-context", () => ({
  useStore: () => ({
    store: { id: "s", businessId: "b" },
    currency: "ZAR",
    canModule: () => mocks.invoices,
  }),
}));
vi.mock("@/features/billing/use-billing-action", () => ({
  useBillingAction: () => ({
    online: true,
    busy: false,
    request: vi.fn(),
    run: vi.fn(),
  }),
}));
vi.mock("@/features/credit/customer-picker", () => ({
  CustomerPicker: () => null,
}));
vi.mock("@/features/operations/product-picker", () => ({
  LocationProductPicker: () => null,
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data:
      queryKey[1] === "orders"
        ? [
            {
              id: "o",
              reference: "ORDER-1",
              customer_name: "Customer",
              created_at: "2026-09-07T10:00:00Z",
              status: mocks.status,
              can_cancel: false,
              invoice: {
                id: "i",
                reference: "INVOICE-1",
                status: "PAID",
                total: 90,
                paid: 90,
                credits: 0,
                outstanding: 0,
                goods_issued_at: "2026-09-07T10:00:00Z",
              },
            },
          ]
        : queryKey[1] === "order-tax"
          ? 15
          : [],
  }),
}));
beforeEach(() => {
  cleanup();
  mocks.invoices = true;
  mocks.status = "COMPLETED";
});
it("shows final invoice amounts and history link without creation or cancellation", () => {
  render(<OrdersConsole />);
  fireEvent.click(screen.getByRole("button", { name: "ORDER-1" }));
  expect(
    screen.getByRole("region", { name: "Order summary" }),
  ).toHaveTextContent("INVOICE-1");
  expect(
    screen.getByRole("link", { name: "View invoice and payment history" }),
  ).toHaveAttribute("href", "/invoices/i");
  expect(
    screen.queryByRole("button", { name: "Create invoice" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Cancel order" }),
  ).not.toBeInTheDocument();
});
it("keeps the summary available for Orders-only staff without linking denied modules", () => {
  mocks.invoices = false;
  render(<OrdersConsole />);
  fireEvent.click(screen.getByRole("button", { name: "ORDER-1" }));
  expect(
    screen.getByRole("region", { name: "Order summary" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: /invoice/i }),
  ).not.toBeInTheDocument();
});

vi.mock("@/features/billing/purchase-order", () => ({ PurchaseOrder: () => null }));
