import { beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { BulkProductDialog } from "@/features/goods-in/bulk-product-dialog";
const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  pick: vi.fn(),
  close: vi.fn(),
  store: "shop",
  online: true,
}));
vi.mock("@/lib/store-context", () => ({
  useStore: () => ({ store: { id: m.store, name: m.store } }),
}));
vi.mock("@/lib/offline/offline-context", () => ({
  useOffline: () => ({ online: m.online }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    rpc: m.rpc,
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        single: async () => ({
          data: { id: "bulk", store_id: m.store, item_type: "Bulk Stock" },
          error: null,
        }),
      };
      return q;
    },
  }),
}));
vi.mock("@/features/operations/product-picker", () => ({
  LocationProductPicker: ({
    label,
    location,
    onChange,
  }: {
    label: string;
    location: string;
    onChange: (p: unknown) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onChange({
          id: label.includes("individual") ? "individual" : "existing-pack",
          store_id: location,
        })
      }
    >
      {label}
    </button>
  ),
}));
beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  m.store = "shop";
  m.online = true;
  m.rpc.mockResolvedValue({ data: "bulk", error: null });
});
function setup() {
  render(<BulkProductDialog onClose={m.close} onPick={m.pick} />);
  fireEvent.click(screen.getByText("Existing individual item"));
  for (const [label, value] of [
    ["Bulk product name", "Juice case"],
    ["Bulk SKU", "CASE"],
    ["Cost per pack", "12"],
    ["Selling price per pack", "18"],
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
it.each(["shop", "warehouse"])(
  "creates a linked bulk product only at %s without receiving stock",
  async (location) => {
    m.store = location;
    setup();
    fireEvent.click(
      screen.getByRole("button", { name: "Save & add bulk to receiving" }),
    );
    await waitFor(() => expect(m.close).toHaveBeenCalledOnce());
    expect(m.rpc).toHaveBeenCalledExactlyOnceWith(
      "create_bulk_product",
      expect.objectContaining({
        p_store: location,
        p_unit: "individual",
        p_name: "Juice case",
        p_ratio: 6,
        p_cost: 12,
        p_selling: 18,
      }),
    );
    expect(m.pick).toHaveBeenCalledWith(
      expect.objectContaining({ store_id: location, item_type: "Bulk Stock" }),
    );
  },
);
it("reuses its request when an uncertain creation is retried", async () => {
  m.rpc.mockResolvedValueOnce({ error: { message: "Network error" } });
  setup();
  fireEvent.click(
    screen.getByRole("button", { name: "Save & add bulk to receiving" }),
  );
  await screen.findByRole("alert");
  fireEvent.click(
    screen.getByRole("button", { name: "Save & add bulk to receiving" }),
  );
  await waitFor(() => expect(m.close).toHaveBeenCalledOnce());
  expect(m.rpc.mock.calls[0][1].p_request).toBe(
    m.rpc.mock.calls[1][1].p_request,
  );
});
it("links an existing product without creating another product", async () => {
  setup();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByText("Existing bulk product"));
  fireEvent.click(
    screen.getByRole("button", { name: "Save & add bulk to receiving" }),
  );
  await waitFor(() => expect(m.close).toHaveBeenCalledOnce());
  expect(m.rpc).toHaveBeenCalledExactlyOnceWith("set_bulk_conversion", {
    p_pack: "existing-pack",
    p_unit: "individual",
    p_ratio: 6,
  });
});
it("cannot create bulk products offline", () => {
  m.online = false;
  setup();
  expect(
    (
      screen.getByRole("button", {
        name: "Save & add bulk to receiving",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
