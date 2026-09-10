import { afterEach, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { LocationOverview } from "@/features/dashboard/location-overview";
import { money } from "@/lib/format";
const state = vi.hoisted(() => ({
  active: "sa",
  stores: [
    { id: "sa", currency: "ZAR" },
    { id: "us", currency: "USD" },
  ],
}));
vi.mock("@/lib/store-context", () => ({
  useStore: () => ({
    store: { id: state.active, businessId: "biz" },
    stores: state.stores,
    can: () => true,
    currency: state.active === "sa" ? "ZAR" : "USD",
    setStore: vi.fn(),
  }),
}));
vi.mock("@/lib/offline/offline-context", () => ({
  useOffline: () => ({ online: true }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: [
      {
        location_id: "sa",
        name: "SA store",
        stock_value: 100,
        stock_quantity: 1,
        product_count: 1,
        location_type: "store",
      },
      {
        location_id: "us",
        name: "US store",
        stock_value: 200,
        stock_quantity: 2,
        product_count: 1,
        location_type: "store",
      },
    ],
  }),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));
afterEach(() => {
  cleanup();
  state.active = "sa";
});
it("keeps each location currency when the active store changes", () => {
  const { rerender } = render(<LocationOverview />);
  const check = () => {
    expect(
      within(screen.getByRole("row", { name: /SA store/ })).getByText(
        money(100, "ZAR").replace(/\s/g," "),
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("row", { name: /US store/ })).getByText(
        money(200, "USD").replace(/\s/g," "),
      ),
    ).toBeInTheDocument();
  };
  check();
  state.active = "us";
  rerender(<LocationOverview />);
  check();
});
