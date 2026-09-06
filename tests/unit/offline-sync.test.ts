import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushSaleQueue } from "@/lib/offline/sync";
const mock = vi.hoisted(() => ({ rpc: vi.fn(), remove: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc: mock.rpc }) }));
vi.mock("@/lib/offline/db", () => ({
  listQueuedSales: async () => [{ id: "sale-request", storeId: "store", items: [{ product_id: "product", quantity: 1, unit_price: 10 }], status: "pending" }],
  removeQueuedSale: mock.remove, updateQueuedSale: mock.update, replaceProductMirror: vi.fn(),
}));
describe("offline replay idempotency", () => {
  beforeEach(() => vi.clearAllMocks());
  it("reuses the persisted request ID after an uncertain network result", async () => {
    mock.rpc.mockResolvedValueOnce({ error: { message: "Network unavailable" } }).mockResolvedValueOnce({ error: null });
    await expect(flushSaleQueue("store")).resolves.toEqual({ synced: 0, failed: 0 });
    expect(mock.remove).not.toHaveBeenCalled();
    await expect(flushSaleQueue("store")).resolves.toEqual({ synced: 1, failed: 0 });
    expect(mock.rpc.mock.calls[0][1].p_request).toBe("sale-request");
    expect(mock.rpc.mock.calls[1][1]).toEqual(mock.rpc.mock.calls[0][1]);
  });
  it("retains a rejected sale for review when location access was revoked", async () => {
    mock.rpc.mockResolvedValue({ error: { message: "FORBIDDEN" } });
    await expect(flushSaleQueue("store")).resolves.toEqual({ synced: 0, failed: 1 });
    expect(mock.update).toHaveBeenCalledWith("sale-request", expect.objectContaining({ status: "failed" }));
    expect(mock.remove).not.toHaveBeenCalled();
  });
});
