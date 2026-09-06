import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TransfersConsole } from "@/features/operations/transfers-console";
const mock = vi.hoisted(() => ({ online: true, rpc: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: [], isLoading: false }), useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc: mock.rpc }) }));
vi.mock("@/lib/offline/offline-context", () => ({ useOffline: () => ({ online: mock.online }) }));
vi.mock("@/lib/store-context", () => ({ useStore: () => ({ store: { id: "source", businessId: "biz" }, stores: [
  { id: "source", businessId: "biz", name: "Warehouse", locationType: "warehouse" },
  { id: "destination", businessId: "biz", name: "Shop", locationType: "store" },
] }) }));
vi.mock("@/features/operations/product-picker", () => ({ LocationProductPicker: ({ label, location, onChange }: { label: string; location: string; onChange: (p: unknown) => void }) =>
  <button onClick={() => onChange({ id: `${location}-product`, name: `${location} milk`, unit: "each", track_expiry: false })}>{label}</button>,
}));
describe("transfer capture", () => {
  beforeEach(() => { cleanup(); mock.online = true; mock.rpc.mockReset(); mock.rpc.mockResolvedValue({ data: "transfer", error: null }); });
  function addItem() {
    fireEvent.change(screen.getByLabelText("Destination location"), { target: { value: "destination" } });
    fireEvent.click(screen.getByText("Source product")); fireEvent.click(screen.getByText("Matching destination product"));
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
  }
  it("keeps the same request ID when retrying an uncertain save", async () => {
    mock.rpc.mockResolvedValueOnce({ data: null, error: { message: "Network error" } });
    render(<TransfersConsole />); addItem();
    fireEvent.click(screen.getByRole("button", { name: "Save draft transfer" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((screen.getByRole("button", { name: "Save draft transfer" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Save draft transfer" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledTimes(2));
    expect(mock.rpc.mock.calls[0][1].p_request).toBe(mock.rpc.mock.calls[1][1].p_request);
    expect(mock.rpc.mock.calls[0][1].p_items).toEqual([{ source_product_id: "source-product", destination_product_id: "destination-product", quantity: 1 }]);
  });
  it("does not offer offline transfer capture", () => {
    mock.online = false; render(<TransfersConsole />);
    expect(screen.getByRole("status").textContent).toContain("require a connection");
    expect((screen.getByRole("button", { name: "Save draft transfer" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
