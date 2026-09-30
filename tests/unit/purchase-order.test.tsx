import { beforeEach, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { PurchaseOrder } from "@/features/billing/purchase-order";
const mocks = vi.hoisted(() => ({
  manager: true,
  approved: false,
  received: false,
  rpc: vi.fn(),
}));
vi.mock("@/lib/store-context", () => ({
  useStore: () => ({ can: () => mocks.manager }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: {
      id: "po",
      version: 4,
      approved: mocks.approved,
      received: mocks.received,
      reference: null,
    },
  }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/features/billing/use-billing-action", () => ({
  useBillingAction: () => ({
    online: true,
    busy: false,
    run: (action: () => Promise<unknown>) => action(),
  }),
}));
beforeEach(() => {
  cleanup();
  mocks.manager = true;
  mocks.approved = false;
  mocks.received = false;
  mocks.rpc.mockReset().mockResolvedValue({ error: null });
});
it("allows approval before receipt and clearing receipt without clearing approval", async () => {
  render(<PurchaseOrder order="order" />);
  const received = screen.getByRole("checkbox", { name: "PO received" });
  const approved = screen.getByRole("checkbox", {
    name: "PO approved by manager/owner",
  });
  expect(approved).toBeEnabled();
  fireEvent.click(approved);
  fireEvent.click(received);
  fireEvent.click(received);
  expect(approved).toBeChecked();
  expect(received).not.toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Save purchase order" }));
  await waitFor(() =>
    expect(mocks.rpc).toHaveBeenCalledWith(
      "save_purchase_order",
      expect.objectContaining({
        p_received: false,
        p_approved: true,
        p_expected: 4,
      }),
    ),
  );
});
it("lets staff record receipt but protects manager approval and approved content", async () => {
  mocks.manager = false;
  mocks.approved = true;
  render(<PurchaseOrder order="order" />);
  expect(
    screen.getByRole("checkbox", { name: "PO approved by manager/owner" }),
  ).toBeDisabled();
  expect(screen.getByLabelText("Customer PO reference")).toBeDisabled();
  expect(screen.getByLabelText("Attach purchase order")).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: "PO received" }));
  fireEvent.click(screen.getByRole("button", { name: "Save purchase order" }));
  await waitFor(() =>
    expect(mocks.rpc).toHaveBeenCalledWith(
      "save_purchase_order",
      expect.objectContaining({
        p_received: true,
        p_approved: true,
        p_reference: null,
      }),
    ),
  );
});
