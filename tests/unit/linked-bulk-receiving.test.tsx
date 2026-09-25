import { beforeEach, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { GoodsInConsole } from "@/features/goods-in/goods-in-console";
const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  product: {
    id: "juice",
    store_id: "shop",
    name: "Juice",
    unit: "each",
    quantity: 0,
    cost_price: 2,
    track_expiry: false,
    bulk_enabled: true,
    bulk_options: [
      {
        id: "linked-case",
        unit: "case",
        units_per_pack: 12,
        quantity: 0,
        cost_price: 24,
      },
    ],
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/store-context", () => ({
  useStore: () => ({
    store: {
      id: "shop",
      businessId: "business",
      name: "Shop",
      locationType: "store",
    },
    stores: [{ id: "shop", name: "Shop", locationType: "store" }],
    currency: "ZAR",
    setStore: vi.fn(),
    can: () => false,
    canModule: () => true,
  }),
}));
vi.mock("@/lib/offline/offline-context", () => ({
  useOffline: () => ({ online: true }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    rpc: m.rpc,
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ order: async () => ({ data: [] }) }) }),
      }),
    }),
  }),
}));
vi.mock("@/features/scan/scan-input", () => ({ ScanInput: () => null }));
vi.mock("@/features/products/product-register-dialog", () => ({
  ProductRegisterDialog: () => null,
}));
vi.mock("@/features/scan/product-search-dialog", () => ({
  ProductSearchDialog: ({
    open,
    onPick,
    onOpenChange,
  }: {
    open: boolean;
    onPick: (p: unknown) => void;
    onOpenChange: (v: boolean) => void;
  }) =>
    open ? (
      <button
        onClick={() => {
          onPick(m.product);
          onOpenChange(false);
        }}
      >
        Choose Juice
      </button>
    ) : null,
}));
beforeEach(() => {
  cleanup();
  m.rpc.mockReset();
  m.rpc.mockResolvedValue({ data: "receipt", error: null });
});
it("receives existing linked packs without creating another catalogue product", async () => {
  render(<GoodsInConsole />);
  fireEvent.click(screen.getByRole("button", { name: "Add product" }));
  fireEvent.click(screen.getByText("Choose Juice"));
  expect(screen.getByRole("button", { name: "Individual" })).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: /Bulk Stock · 1 case = 12/ }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: /Confirm & add to stock/ }),
  );
  await waitFor(() =>
    expect(m.rpc).toHaveBeenCalledWith(
      "receive_stock",
      expect.objectContaining({
        p_store: "shop",
        p_items: [
          expect.objectContaining({
            product_id: "linked-case",
            quantity: 1,
            unit_cost: 24,
          }),
        ],
      }),
    ),
  );
  expect(m.rpc.mock.calls.map((c) => c[0])).toEqual(["receive_stock"]);
});
