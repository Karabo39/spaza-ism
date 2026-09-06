import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { UnpackConsole } from "@/features/operations/unpack-console";
const mock = vi.hoisted(() => ({ online: true, manager: false, rpc: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data:
      queryKey[0] === "bulk-conversions"
        ? [
            {
              id: "conversion",
              pack_name: "Six pack",
              unit_name: "Bottle",
              units_per_pack: 6,
            },
          ]
        : [],
  }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: mock.rpc }),
}));
vi.mock("@/lib/offline/offline-context", () => ({
  useOffline: () => ({ online: mock.online }),
}));
vi.mock("@/lib/store-context", () => ({
  useStore: () => ({
    store: { id: "shop", name: "Shop" },
    can: () => mock.manager,
  }),
}));
vi.mock("@/features/operations/product-picker", () => ({
  LocationProductPicker: () => null,
}));
describe("bulk unpack capture", () => {
  beforeEach(() => {
    cleanup();
    mock.online = true;
    mock.manager = false;
    mock.rpc.mockReset();
    mock.rpc.mockResolvedValue({ data: "unpacking", error: null });
  });
  it("previews the configured conversion and posts the reason through the RPC", async () => {
    render(<UnpackConsole />);
    fireEvent.change(screen.getByLabelText("Configured pack"), {
      target: { value: "conversion" },
    });
    fireEvent.change(screen.getByLabelText("Number of packs"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText("Reason / reference"), {
      target: { value: "Refill shelf" },
    });
    expect(screen.getByText(/Remove 2/).textContent).toContain("12");
    fireEvent.click(screen.getByRole("button", { name: "Confirm unpacking" }));
    await waitFor(() =>
      expect(mock.rpc).toHaveBeenCalledWith(
        "unpack_stock",
        expect.objectContaining({
          p_conversion: "conversion",
          p_packs: 2,
          p_reason: "Refill shelf",
        }),
      ),
    );
    expect(
      screen.queryByRole("button", { name: "Save conversion" }),
    ).toBeNull();
  });
  it("blocks offline unpacking", () => {
    mock.online = false;
    render(<UnpackConsole />);
    expect(
      (
        screen.getByRole("button", {
          name: "Confirm unpacking",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
  it("requires a manager count and records the shortage correction through its RPC", async () => {
    mock.manager = true;
    render(<UnpackConsole />);
    fireEvent.change(screen.getByLabelText("Configured pack"), {
      target: { value: "conversion" },
    });
    fireEvent.change(screen.getByLabelText("Reason / reference"), {
      target: { value: "Verified physical count" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByLabelText("Total physical packs counted"), {
      target: { value: "2" },
    });
    fireEvent.change(
      screen.getByLabelText("Expiry of newly counted packs (if tracked)"),
      { target: { value: "2028-01-01" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm unpacking" }));
    await waitFor(() =>
      expect(mock.rpc).toHaveBeenCalledWith(
        "unpack_stock_with_count",
        expect.objectContaining({
          p_counted: 2,
          p_expiry: "2028-01-01",
          p_reason: "Verified physical count",
        }),
      ),
    );
  });
});
