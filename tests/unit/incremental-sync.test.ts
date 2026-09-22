import { beforeEach, expect, it, vi } from "vitest";
import { syncProductMirror } from "@/lib/offline/sync";
const mock = vi.hoisted(() => ({
  rpc: vi.fn(),
  versions: vi.fn(),
  merge: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: mock.rpc }),
}));
vi.mock("@/lib/offline/db", () => ({
  mirrorVersions: mock.versions,
  mergeProductMirror: mock.merge,
}));
beforeEach(() => {
  vi.clearAllMocks();
  mock.versions.mockResolvedValue({
    unchanged: "v1",
    changed: "v1",
    deleted: "v0",
  });
});
it("fetches only changed records and commits a deletion-aware manifest", async () => {
  mock.rpc
    .mockResolvedValueOnce({
      data: [
        { id: "unchanged", version: "v1" },
        { id: "changed", version: "v2" },
      ],
      error: null,
    })
    .mockResolvedValueOnce({
      data: [{ id: "changed", _barcodes: ["NEW"] }],
      error: null,
    });
  await syncProductMirror("store");
  expect(mock.rpc).toHaveBeenLastCalledWith("catalog_sync_products", {
    p_store: "store",
    p_ids: ["changed"],
  });
  expect(mock.merge).toHaveBeenCalledWith(
    "store",
    [{ id: "changed", _barcodes: ["NEW"] }],
    { unchanged: "v1", changed: "v2" },
  );
});
it("retains the previous complete mirror when any page fails", async () => {
  mock.rpc
    .mockResolvedValueOnce({
      data: [{ id: "changed", version: "v2" }],
      error: null,
    })
    .mockResolvedValueOnce({
      data: null,
      error: { message: "Network unavailable" },
    });
  await expect(syncProductMirror("store")).rejects.toMatchObject({
    message: "Network unavailable",
  });
  expect(mock.merge).not.toHaveBeenCalled();
});
it("coalesces overlapping syncs and skips unchanged row downloads", async () => {
  mock.rpc.mockResolvedValue({
    data: [{ id: "unchanged", version: "v1" }],
    error: null,
  });
  await Promise.all([syncProductMirror("store"), syncProductMirror("store")]);
  expect(mock.rpc).toHaveBeenCalledTimes(1);
  expect(mock.merge).toHaveBeenCalledTimes(1);
});
