import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import {
  replaceProductMirror, localFindByBarcode, localSearch, localAdjustQuantity,
  enqueueSale, listQueuedSales, updateQueuedSale, removeQueuedSale, type QueuedSale,
} from "@/lib/offline/db";
import type { ProductStock } from "@/lib/db/database.types";

const STORE = "store-1";

function product(id: string, name: string, quantity = 10): ProductStock {
  return {
    id, business_id: "biz-1", store_id: STORE, name, sku: null, unit: "each",
    cost_price: 5, selling_price: 10, min_stock_level: 2, reorder_level: 4,
    track_expiry: false, is_active: true, category_id: null, default_supplier_id: null,
    quantity, stock_value: quantity * 5, retail_value: quantity * 10,
    category_name: null, supplier_name: null, stock_status: "ok", suggested_reorder: 0,
  };
}

describe("offline product mirror", () => {
  beforeEach(async () => {
    await replaceProductMirror(
      STORE,
      [product("p1", "Milk 1L", 10), product("p2", "Bread", 3)],
      [{ barcode: "111", product_id: "p1", store_id: STORE }],
    );
  });

  it("finds a product by barcode", async () => {
    const hit = await localFindByBarcode(STORE, "111");
    expect(hit?.name).toBe("Milk 1L");
  });

  it("returns null for unknown barcode", async () => {
    expect(await localFindByBarcode(STORE, "999")).toBeNull();
  });

  it("searches by name", async () => {
    const rows = await localSearch(STORE, "bread");
    expect(rows.map((r) => r.id)).toEqual(["p2"]);
  });

  it("optimistically reduces quantity and never goes negative", async () => {
    await localAdjustQuantity("p1", -4);
    expect((await localFindByBarcode(STORE, "111"))?.quantity).toBe(6);
    await localAdjustQuantity("p1", -100);
    expect((await localFindByBarcode(STORE, "111"))?.quantity).toBe(0);
  });
});

describe("offline sales outbox", () => {
  const sale: QueuedSale = {
    id: "s1", storeId: STORE, items: [{ product_id: "p1", quantity: 2, unit_price: 10 }],
    total: 20, createdAt: Date.now(), status: "pending",
  };

  it("enqueues, lists, updates status, and removes", async () => {
    await enqueueSale(sale);
    let rows = await listQueuedSales(STORE);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pending");

    await updateQueuedSale("s1", { status: "failed", error: "INSUFFICIENT_STOCK" });
    rows = await listQueuedSales(STORE);
    expect(rows[0].status).toBe("failed");
    expect(rows[0].error).toContain("INSUFFICIENT");

    await removeQueuedSale("s1");
    expect(await listQueuedSales(STORE)).toHaveLength(0);
  });
});
