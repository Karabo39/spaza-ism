import { describe, it, expect, vi } from "vitest";
import {
  orderingHandler,
  type OrderingBackend,
} from "../../supabase/functions/customer-ordering/handler";
const link = "11111111-1111-1111-1111-111111111111";
function request(body: unknown, origin = "https://posinventory.shop") {
  return new Request("https://edge.test/customer-ordering", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
function backend() {
  return {
    rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
    images: vi
      .fn()
      .mockResolvedValue({ "b/s/p/photo.png": "https://images.test/signed" }),
  } satisfies OrderingBackend;
}
describe("restricted customer ordering", () => {
  it("rejects other origins and invalid store links before reading data", async () => {
    const db = backend(),
      handler = orderingHandler(db);
    expect(
      (
        await handler(
          request({ action: "catalog", link }, "https://other.test"),
        )
      ).status,
    ).toBe(403);
    expect(
      (await handler(request({ action: "catalog", link: "not-a-store" })))
        .status,
    ).toBe(400);
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("signs only returned catalogue images and removes storage paths", async () => {
    const db = backend();
    db.rpc.mockResolvedValue({
      data: {
        products: [{ id: "p", name: "Water", image_path: "b/s/p/photo.png" }],
      },
      error: null,
    });
    const response = await orderingHandler(db)(
      request({ action: "catalog", link }),
    );
    expect((await response.json()).data.products).toEqual([
      { id: "p", name: "Water", image_url: "https://images.test/signed" },
    ]);
    expect(db.images).toHaveBeenCalledWith(["b/s/p/photo.png"]);
  });
  it("requires the private token for status and never accepts arbitrary RPC names", async () => {
    const db = backend(),
      handler = orderingHandler(db);
    expect(
      (
        await handler(
          request({ action: "status", link, order: link, secret: "short" }),
        )
      ).status,
    ).toBe(404);
    expect(
      (await handler(request({ action: "execute_sql", link }))).status,
    ).toBe(400);
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("drops injected prices/privileges and rate limits placement before its service RPC", async () => {
    const db = backend();
    db.rpc
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: { order_id: link }, error: null });
    const response = await orderingHandler(db)(
      request({
        action: "place",
        link,
        request: link,
        secret: "a".repeat(64),
        items: [
          { product_id: link, quantity: 2, unit_price: 0, cost_price: 0 },
        ],
        contact: {
          name: "Buyer",
          phone: "123",
          email_notifications: true,
          credit_enabled: true,
        },
        fulfilment: "COLLECTION",
        date: "2026-10-05",
        payment: "BANK_TRANSFER",
      }),
    );
    expect(response.status).toBe(200);
    expect(db.rpc.mock.calls[0][0]).toBe("online_rate_limit");
    const args = db.rpc.mock.calls[1][1];
    expect(args.p_items).toEqual([{ product_id: link, quantity: 2 }]);
    expect(args.p_contact).not.toHaveProperty("credit_enabled");
  });
  it("rejects spam, oversized requests and non-finite quantities without placing an order", async () => {
    const db = backend(),
      handler = orderingHandler(db);
    const response = await handler(
      request({
        action: "place",
        link,
        request: link,
        secret: "a".repeat(64),
        website: "spam",
      }),
    );
    expect(response.status).toBe(400);
    expect(
      (
        await handler(
          request({ action: "catalog", link, extra: "a".repeat(16000) }),
        )
      ).status,
    ).toBe(413);
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("does not expose internal database exception details", async () => {
    const db = backend();
    db.rpc.mockResolvedValue({
      data: null,
      error: { message: "secret table name and cost 123" },
    });
    const response = await orderingHandler(db)(
      request({ action: "catalog", link }),
    );
    expect(await response.json()).toEqual({ error: "UNABLE_TO_COMPLETE" });
  });
});
