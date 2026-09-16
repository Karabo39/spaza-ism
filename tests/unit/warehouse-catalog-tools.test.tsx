import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { WarehouseCatalogTools } from "@/features/operations/warehouse-catalog-tools";
import { WarehouseEdit } from "@/features/operations/warehouse-edit";
const m = vi.hoisted(() => ({
  online: true,
  owner: true,
  rpc: vi.fn(),
  refresh: vi.fn(),
  parse: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: m.refresh }),
}));
vi.mock("@/lib/offline/offline-context", () => ({
  useOffline: () => ({ online: m.online }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: m.rpc }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: null, refetch: vi.fn() }),
}));
vi.mock("@/features/imports/import-format", () => ({
  parseImport: m.parse,
  importTemplate: vi.fn(),
}));
vi.mock("@/lib/store-context", () => ({
  useStore: () => ({
    user: { id: "user" },
    store: { id: "shop", businessId: "biz", locationType: "store" },
    can: () => m.owner,
    stores: [
      {
        id: "shop",
        name: "Shop",
        businessId: "biz",
        locationType: "store",
        currency: "ZAR",
        modules: {},
      },
      {
        id: "wh",
        name: "Warehouse",
        businessId: "biz",
        locationType: "warehouse",
        currency: "ZAR",
        modules: { warehouse: true },
      },
    ],
  }),
}));
beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
  m.online = true;
  m.owner = true;
  m.rpc.mockResolvedValue({
    data: { created: 1, updated: 0, skipped: 0 },
    error: null,
  });
});
describe("warehouse catalogue controls", () => {
  it("saves the chosen source and automatic schedule, preventing duplicate clicks", async () => {
    m.rpc.mockReturnValue(new Promise(() => {}));
    render(<WarehouseCatalogTools />);
    fireEvent.click(screen.getByText("Sync Products"));
    const button = screen.getByText("Sync products and save schedule");
    fireEvent.click(button);
    fireEvent.click(button);
    expect(m.rpc).toHaveBeenCalledExactlyOnceWith("sync_warehouse_products", {
      p_warehouse: "wh",
      p_preferred: "shop",
      p_auto: true,
    });
  });
  it("allows offline preview but cannot submit until reconnected; quantities are discarded", async () => {
    m.online = false;
    m.parse.mockResolvedValue([
      {
        id: "product",
        name: "Milk",
        sku: "MILK",
        quantity: 999,
        expiry_date: "2030-01-01",
      },
    ]);
    const view = render(<WarehouseCatalogTools />);
    fireEvent.click(screen.getByText("Sync Products"));
    fireEvent.change(
      screen.getByLabelText("Upload warehouse product template"),
      {
        target: {
          files: [
            {
              name: "products.xlsx",
              size: 20,
              arrayBuffer: async () => new ArrayBuffer(0),
            },
          ],
        },
      },
    );
    await screen.findByText(/1 product rows ready/);
    const apply = screen.getByText("Apply product details to warehouse");
    expect((apply as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(apply);
    expect(m.rpc).not.toHaveBeenCalled();
    expect(localStorage.getItem("warehouse-catalog-draft:user:wh")).not.toMatch(
      /quantity|expiry_date/,
    );
    m.online = true;
    view.rerender(<WarehouseCatalogTools />);
    fireEvent.click(screen.getByText("Apply product details to warehouse"));
    await waitFor(() =>
      expect(m.rpc).toHaveBeenCalledWith("import_warehouse_catalog", {
        p_warehouse: "wh",
        p_rows: [{ id: "product", name: "Milk", sku: "MILK" }],
      }),
    );
  });
  it("does not expose sync to a non-owner", () => {
    m.owner = false;
    render(<WarehouseCatalogTools />);
    expect(screen.queryByText("Sync Products")).toBeNull();
  });
  it("saves warehouse details through the existing audited action", async () => {
    render(<WarehouseEdit id="wh" name="Old warehouse" code="OLD" />);
    fireEvent.click(screen.getByText("Edit warehouse details"));
    fireEvent.change(screen.getByLabelText("Warehouse name"), {
      target: { value: " Central warehouse " },
    });
    fireEvent.change(screen.getByLabelText("Warehouse code (optional)"), {
      target: { value: " WH01 " },
    });
    fireEvent.click(screen.getByText("Save warehouse details"));
    await waitFor(() =>
      expect(m.rpc).toHaveBeenCalledWith("update_location", {
        p_store: "wh",
        p_name: "Central warehouse",
        p_code: "WH01",
      }),
    );
  });
});

it("only exposes disabling with its warehouse permission", () => {
  render(<WarehouseEdit id="wh" name="Warehouse" code="WH" />);
  fireEvent.click(screen.getByText("Edit warehouse details"));
  expect(
    screen.queryByRole("button", { name: "Disable warehouse" }),
  ).toBeNull();
});
it("displays the stock guard and refreshes after a successful disable", async () => {
  m.rpc.mockResolvedValueOnce({ error: { message: "WAREHOUSE_HAS_STOCK" } });
  render(<WarehouseEdit id="wh" name="Warehouse" code="WH" canDisable />);
  fireEvent.click(screen.getByText("Edit warehouse details"));
  fireEvent.click(screen.getByRole("button", { name: "Disable warehouse" }));
  await screen.findByRole("alert");
  expect(m.refresh).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain(
    "Every product quantity must be zero",
  );
  fireEvent.click(screen.getByRole("button", { name: "Disable warehouse" }));
  await waitFor(() => expect(m.refresh).toHaveBeenCalledOnce());
  expect(m.rpc).toHaveBeenLastCalledWith("disable_warehouse", {
    p_store: "wh",
  });
});
