import { beforeEach, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { InvoiceAmendments } from "@/features/billing/invoice-amendments";
import type { InvoiceBalance, SalesInvoiceItem } from "@/lib/db/database.types";
const m = vi.hoisted(() => ({
  manager: true,
  online: true,
  rpc: vi.fn(),
  queries: [] as { enabled: boolean }[],
}));
vi.mock("@/lib/store-context", () => ({
  useStore: () => ({
    can: () => m.manager,
    store: { id: "store" },
    currency: "ZAR",
  }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: m.rpc }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (q: { enabled: boolean }) => {
    m.queries.push(q);
    return { data: [] };
  },
}));
vi.mock("@/features/operations/product-picker", () => ({
  LocationProductPicker: ({ onChange }: { onChange: (p: unknown) => void }) => (
    <button
      type="button"
      onClick={() =>
        onChange({ id: "replacement", name: "Replacement", selling_price: 20 })
      }
    >
      Pick replacement
    </button>
  ),
}));
vi.mock("@/features/billing/use-billing-action", () => ({
  useBillingAction: () => ({
    online: m.online,
    busy: false,
    request: () => "request-id",
    run: async (
      fn: () => Promise<unknown>,
      _label: string,
      done: () => void,
    ) => {
      await fn();
      done();
    },
  }),
}));
const invoice = {
  id: "invoice",
  state: "ISSUED",
  total: 20,
  paid: 20,
  discount: 0,
  tax_percent: 0,
  credits: 0,
  debits: 0,
  revision: 3,
} as InvoiceBalance;
const items = [
  {
    id: "line",
    product_id: "original",
    product_name: "Original",
    quantity: 2,
    unit_price: 10,
  },
] as SalesInvoiceItem[];
beforeEach(() => {
  cleanup();
  m.manager = true;
  m.online = true;
  m.rpc.mockReset().mockResolvedValue({ error: null });
  m.queries = [];
});
it("replaces items on the existing invoice with its revision and keeps payment out of the mutation", async () => {
  render(<InvoiceAmendments invoice={invoice} items={items} />);
  expect(m.queries[0].enabled).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Edit order items" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  fireEvent.click(screen.getByRole("button", { name: "Pick replacement" }));
  fireEvent.click(screen.getByRole("button", { name: "Add product" }));
  fireEvent.change(screen.getByLabelText("Quantity for Replacement"), {
    target: { value: "2" },
  });
  fireEvent.change(screen.getByLabelText("Reason for correction"), {
    target: { value: "Unavailable stock" },
  });
  expect(screen.getByText(/Amount still due:/)).toHaveTextContent(/40|20/);
  fireEvent.click(screen.getByRole("button", { name: "Save corrected order" }));
  await waitFor(() =>
    expect(m.rpc).toHaveBeenCalledWith("amend_invoice_items", {
      p_invoice: "invoice",
      p_expected: 3,
      p_items: [{ product_id: "replacement", quantity: 2, unit_price: 20 }],
      p_discount: 0,
      p_reason: "Unavailable stock",
      p_request: "request-id",
    }),
  );
});
it("shows retained overpayment as credit and requires a reason", () => {
  render(<InvoiceAmendments invoice={invoice} items={items} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit order items" }));
  fireEvent.change(screen.getByLabelText("Quantity for Original"), {
    target: { value: "1" },
  });
  expect(
    screen.getByText(/Customer credit after correction/),
  ).toHaveTextContent("No automatic cash refund");
  expect(
    screen.getByRole("button", { name: "Save corrected order" }),
  ).toBeDisabled();
  expect(m.rpc).not.toHaveBeenCalled();
});
it("does not permit editing after release, offline, or without manager access", () => {
  m.manager = false;
  const view = render(<InvoiceAmendments invoice={invoice} items={items} />);
  expect(screen.queryByRole("button", { name: "Edit order items" })).toBeNull();
  m.manager = true;
  view.rerender(
    <InvoiceAmendments
      invoice={{ ...invoice, goods_issued_at: "2026-09-29" }}
      items={items}
    />,
  );
  expect(screen.queryByRole("button", { name: "Edit order items" })).toBeNull();
  m.online = false;
  view.rerender(<InvoiceAmendments invoice={invoice} items={items} />);
  expect(
    screen.getByRole("button", { name: "Edit order items" }),
  ).toBeDisabled();
});
