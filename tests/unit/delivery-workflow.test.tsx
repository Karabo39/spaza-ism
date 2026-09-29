import { beforeEach, it, expect, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { DeliveryPanel } from "@/features/deliveries/delivery-panel";
import type { DeliveryDetail } from "@/features/deliveries/types";
const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  allowed: true,
  manager: true,
  detail: {} as DeliveryDetail,
}));
vi.mock("@/lib/store-context", () => ({
  useStore: () => ({ canModule: () => m.allowed, can: () => m.manager }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: m.rpc }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: m.detail }),
}));
vi.mock("@/features/deliveries/delivery-history", () => ({
  DeliveryHistory: () => null,
}));
vi.mock("@/features/billing/use-billing-action", () => ({
  useBillingAction: () => ({
    online: true,
    busy: false,
    request: () => "request",
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
beforeEach(() => {
  cleanup();
  m.allowed = true;
  m.manager = true;
  m.rpc.mockReset().mockResolvedValue({ error: null });
  m.detail = {
    order: {
      id: "order",
      reference: "ORD-1",
      status: "CONFIRMED",
      required: true,
      details: { date: "2026-10-01", address: "Road", phone: "123" },
      version: 1,
    },
    customer: { name: "Buyer", address: "Road", phone: "123" },
    payment_status: "PAID",
    goods_issued_at: "2026-09-29T10:00:00Z",
    invoice_id: "invoice",
    timezone: "Africa/Johannesburg",
    delivery: {
      id: "delivery",
      invoice_id: "invoice",
      business_id: "business",
      store_id: "store",
      reference: "DN-1",
      status: "OUT_FOR_DELIVERY",
      version: 3,
      original_date: "2026-10-01",
      scheduled_date: "2026-10-01",
      snapshot: {
        business_name: "Business",
        business_address: "Street",
        business_phone: "123",
        business_email: "",
        store_name: "Shop",
        order_id: "order",
        order_reference: "ORD-1",
        invoice_reference: "INV-1",
        customer_id: "customer",
        customer_name: "Buyer",
        company_name: "",
        customer_code: "123",
        delivery_address: "Road",
        contact_number: "123",
        items: [],
      },
      driver_name: "Driver",
      vehicle_registration: "ABC123",
      delivery_reference: null,
      comments: null,
      delivered_at: null,
      confirmed_at: null,
      confirmed_by: null,
      received_by: null,
      receiver_phone: null,
      cancelled_at: null,
      cancelled_by: null,
      cancellation_reason: null,
    },
  };
});
it("requires confirmation and recipient before completing delivery", async () => {
  render(<DeliveryPanel orderId="order" />);
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm delivered / completed" }),
  );
  expect(m.rpc).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Received by")).toBeRequired();
  fireEvent.change(screen.getByLabelText("Received by"), {
    target: { value: "Recipient" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  await waitFor(() =>
    expect(m.rpc).toHaveBeenCalledWith(
      "process_delivery",
      expect.objectContaining({
        p_id: "delivery",
        p_expected: 3,
        p_action: "complete",
        p_details: expect.objectContaining({ received_by: "Recipient" }),
      }),
    ),
  );
});
it("requires an explanation for Other cancellation and warns about separate refunds", () => {
  render(<DeliveryPanel orderId="order" />);
  fireEvent.click(screen.getByRole("button", { name: "Cancel delivery" }));
  fireEvent.change(screen.getByLabelText("Cancellation reason"), {
    target: { value: "Other" },
  });
  expect(screen.getByLabelText("Explanation (required)")).toBeRequired();
  expect(screen.getByRole("dialog")).toHaveTextContent(
    "Payment and stock remain recorded",
  );
  expect(m.rpc).not.toHaveBeenCalled();
});
it("requires a new date when rescheduling and preserves the scheduled date on cancel", () => {
  render(<DeliveryPanel orderId="order" />);
  fireEvent.click(screen.getByRole("button", { name: "Reschedule delivery" }));
  expect(screen.getByLabelText("New delivery date")).toBeRequired();
  fireEvent.click(screen.getByRole("button", { name: "Go back" }));
  expect(m.rpc).not.toHaveBeenCalled();
});
it("blocks dispatch until goods are released", () => {
  m.detail.delivery!.status = "PENDING";
  m.detail.goods_issued_at = null;
  render(<DeliveryPanel orderId="order" />);
  expect(
    screen.getByRole("button", { name: "Mark out for delivery" }),
  ).toBeDisabled();
});
it("hides mutation controls for completed deliveries", () => {
  m.detail.delivery!.status = "DELIVERED";
  m.detail.delivery!.delivered_at = "2026-09-29T10:00:00Z";
  m.detail.delivery!.confirmed_at = "2026-09-29T10:00:00Z";
  render(<DeliveryPanel orderId="order" />);
  expect(screen.queryByRole("button", { name: "Cancel delivery" })).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Reschedule delivery" }),
  ).toBeNull();
});
it("does not give employees the paid-order cancellation control", () => {
  m.manager = false;
  render(<DeliveryPanel orderId="order" />);
  expect(
    screen.queryByRole("button", { name: "Cancel order and delivery" }),
  ).toBeNull();
  expect(screen.getByRole("button", { name: "Cancel delivery" })).toBeEnabled();
});
it("hides delivery details when the store permission is denied", () => {
  m.allowed = false;
  const { container } = render(<DeliveryPanel orderId="order" />);
  expect(container).toBeEmptyDOMElement();
});
