import { beforeEach, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { SyncStoreProducts } from "@/features/products/sync-store-products";
const m = vi.hoisted(() => ({ rpc: vi.fn(), online: true, manager: true }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/offline/offline-context", () => ({
  useOffline: () => ({ online: m.online }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: m.rpc }),
}));
vi.mock("@/lib/store-context", () => ({
  useStore: () => ({
    store: {
      id: "shop",
      name: "Selected store",
      businessId: "b",
      locationType: "store",
    },
    can: () => m.manager,
    canModule: () => true,
    stores: [
      {
        id: "wh",
        name: "Warehouse",
        businessId: "b",
        locationType: "warehouse",
        currency: "ZAR",
        modules: { warehouse: true },
      },
      {
        id: "foreign",
        name: "Foreign",
        businessId: "other",
        locationType: "warehouse",
        modules: { warehouse: true },
      },
      {
        id: "denied",
        name: "Denied",
        businessId: "b",
        locationType: "warehouse",
        modules: { warehouse: false },
      },
    ],
  }),
}));
beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  m.online = true;
  m.manager = true;
  m.rpc.mockImplementation((_name, args) =>
    Promise.resolve({
      data: {
        created: 1,
        updated: 0,
        matched: 1,
        skipped: 0,
        errors: [],
        preview: args.p_preview,
      },
      error: null,
    }),
  );
});
it("previews before writing and binds both calls to the selected store", async () => {
  render(<SyncStoreProducts />);
  fireEvent.click(screen.getByRole("button", { name: "Sync Products" }));
  expect(
    screen.queryByRole("button", { name: "Sync products" }),
  ).not.toBeInTheDocument();
  expect(screen.getAllByRole("option")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Preview sync" }));
  await screen.findByText(/Preview: 1 new/);
  expect(m.rpc).toHaveBeenCalledWith("sync_store_products", {
    p_store: "shop",
    p_warehouse: "wh",
    p_preview: true,
  });
  fireEvent.click(screen.getByRole("button", { name: "Sync products" }));
  await screen.findByText(/Completed: 1 new/);
  expect(m.rpc).toHaveBeenCalledWith("sync_store_products", {
    p_store: "shop",
    p_warehouse: "wh",
    p_preview: false,
  });
  expect(
    screen.getByText(/Existing store cost and selling prices stay unchanged/),
  ).toBeVisible();
});
it("blocks repeated submissions and offline writes", async () => {
  m.rpc.mockReturnValue(new Promise(() => {}));
  render(<SyncStoreProducts />);
  fireEvent.click(screen.getByRole("button", { name: "Sync Products" }));
  const preview = screen.getByRole("button", { name: "Preview sync" });
  fireEvent.click(preview);
  fireEvent.click(preview);
  await waitFor(() => expect(m.rpc).toHaveBeenCalledTimes(1));
});
it("does not offer catalog sync to employees", () => {
  m.manager = false;
  render(<SyncStoreProducts />);
  expect(screen.queryByText("Sync Products")).toBeNull();
});
it("does not open sync while offline", () => {
  m.online = false;
  render(<SyncStoreProducts />);
  expect(screen.getByRole("button", { name: "Sync Products" })).toBeDisabled();
});
