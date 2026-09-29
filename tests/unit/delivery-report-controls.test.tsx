import { beforeEach, it, expect, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DeliveryReport } from "@/features/deliveries/delivery-report";
const m = vi.hoisted(() => ({ rpc: vi.fn(), allow: false }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: m.rpc }),
}));
vi.mock("@/lib/store-context", () => ({
  useStore: () => {
    const store = {
      id: "store",
      name: "Main",
      businessId: "business",
      businessName: "Demo",
      locationType: "store",
      modules: {
        reports_delivery: true,
        reports_delivery_print: m.allow,
        reports_delivery_excel: m.allow,
        reports_delivery_pdf: m.allow,
      },
    };
    return { store, stores: [store] };
  },
}));
beforeEach(() => {
  cleanup();
  m.allow = false;
  m.rpc
    .mockReset()
    .mockResolvedValue({
      data: {
        rows: [],
        next: null,
        until: 0,
        summary: {
          total: 0,
          delivered: 0,
          pending: 0,
          scheduled: 0,
          out_for_delivery: 0,
          rescheduled: 0,
          failed: 0,
          cancelled: 0,
          values: [],
        },
      },
      error: null,
    });
});
function mount() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <DeliveryReport />
    </QueryClientProvider>,
  );
}
it("shows report viewing but hides denied print and export controls", async () => {
  mount();
  await screen.findByText(/No matching deliveries/);
  expect(screen.getByRole("button", { name: "View report" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: "Print report" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Excel Export" })).toBeNull();
  expect(screen.queryByRole("button", { name: "PDF Export" })).toBeNull();
  expect(m.rpc).toHaveBeenCalledTimes(1);
  expect(m.rpc).toHaveBeenCalledWith(
    "delivery_report",
    expect.objectContaining({ p_mode: "view", p_limit: 50 }),
  );
});
it("waits for View report before applying typed filters", async () => {
  mount();
  await screen.findByText(/No matching deliveries/);
  fireEvent.change(screen.getByLabelText("Driver name"), {
    target: { value: "Thabo" },
  });
  expect(m.rpc).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "View report" }));
  await waitFor(() =>
    expect(m.rpc).toHaveBeenCalledWith(
      "delivery_report",
      expect.objectContaining({
        p_filters: { date_field: "delivery", driver: "Thabo" },
      }),
    ),
  );
});
it("enables independently permitted outputs without fetching exports eagerly", async () => {
  m.allow = true;
  mount();
  await screen.findByText(/No matching deliveries/);
  expect(screen.getByRole("button", { name: "Print report" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Excel Export" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "PDF Export" })).toBeEnabled();
  expect(m.rpc).toHaveBeenCalledTimes(1);
});
