import { describe, it, expect, vi, beforeEach } from "vitest";
import { readCursor, collectPages } from "@/lib/data-pages";
import { lookupByCode, searchProducts } from "@/features/scan/lookup";
const mock = vi.hoisted(() => ({
  rpc: vi.fn(),
  local: vi.fn(),
  search: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: mock.rpc }),
}));
vi.mock("@/lib/offline/db", () => ({
  localFindByBarcode: mock.local,
  localSearch: mock.search,
}));
beforeEach(() => vi.clearAllMocks());
describe("bounded page traversal", () => {
  it("rejects malformed and injected cursors", () => {
    expect(
      readCursor('{"id":"x),id.gt.y","created_at":"2026-09-22"}'),
    ).toBeNull();
    expect(readCursor("not json")).toBeNull();
  });
  it("collects all pages and detects a stuck cursor", async () => {
    const cursor = {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Same name",
    };
    const load = vi
      .fn()
      .mockResolvedValueOnce({ rows: [1], next: cursor })
      .mockResolvedValueOnce({ rows: [2], next: null });
    expect(await collectPages(load)).toEqual([1, 2]);
    expect(load).toHaveBeenLastCalledWith(cursor);
    await expect(
      collectPages(async () => ({ rows: [1], next: cursor })),
    ).rejects.toThrow("did not advance");
  });
});
describe("single request lookup", () => {
  it("resolves a barcode through exactly one RPC", async () => {
    mock.rpc.mockResolvedValue({ data: { id: "product" }, error: null });
    expect(await lookupByCode("store", " 123 ")).toEqual({
      product: { id: "product" },
    });
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith("resolve_product_code", {
      p_store: "store",
      p_code: "123",
    });
  });
  it("never substitutes cached data for an online access denial", async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { message: "FORBIDDEN" } });
    await expect(lookupByCode("store", "123")).rejects.toMatchObject({
      message: "FORBIDDEN",
    });
    expect(mock.local).not.toHaveBeenCalled();
  });
  it("keeps network fallback available", async () => {
    mock.rpc.mockResolvedValue({
      data: null,
      error: { message: "Failed to fetch" },
    });
    mock.local.mockResolvedValue({ id: "cached" });
    expect(await lookupByCode("store", "123")).toEqual({
      product: { id: "cached" },
    });
  });
  it("forwards cancellation without running an offline search", async () => {
    const controller = new AbortController();
    controller.abort();
    const abortSignal = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: "AbortError" } });
    mock.rpc.mockReturnValue({ abortSignal });
    await expect(
      searchProducts("store", "Apple", controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(abortSignal).toHaveBeenCalledWith(controller.signal);
    expect(mock.search).not.toHaveBeenCalled();
  });
});
