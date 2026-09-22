import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import {
  replaceProductMirror,
  localFindByBarcode,
  localSearch,
  localAdjustQuantity,
  enqueueSaleAndAdjust,
  enqueueSale,
  listQueuedSales,
  updateQueuedSale,
  removeQueuedSale,
  mergeProductMirror,
  type QueuedSale,
} from "@/lib/offline/db";
import type { ProductStock } from "@/lib/db/database.types";

const STORE = "store-1";

function product(id: string, name: string, quantity = 10): ProductStock {
  return {
    id,
    business_id: "biz-1",
    store_id: STORE,
    name,
    sku: null,
    unit: "each",
    cost_price: 5,
    selling_price: 10,
    min_stock_level: 2,
    reorder_level: 4,
    track_expiry: false,
    is_active: true,
    category_id: null,
    default_supplier_id: null,
    quantity,
    stock_value: quantity * 5,
    retail_value: quantity * 10,
    category_name: null,
    supplier_name: null,
    stock_status: "ok",
    suggested_reorder: 0,
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

  it("keeps the same barcode isolated between stores", async () => {
    await replaceProductMirror(
      "store-2",
      [{ ...product("other", "Other milk"), store_id: "store-2" }],
      [{ barcode: "111", product_id: "other", store_id: "store-2" }],
    );
    expect((await localFindByBarcode(STORE, "111"))?.id).toBe("p1");
    expect((await localFindByBarcode("store-2", "111"))?.id).toBe("other");
  });

  it("merges changes without losing queued reservations or obsolete barcodes", async () => {
    const queued: QueuedSale = {
      id: "merge-sale",
      storeId: STORE,
      items: [{ product_id: "p1", quantity: 2, unit_price: 10 }],
      total: 20,
      createdAt: Date.now(),
      status: "pending",
    };
    await enqueueSaleAndAdjust(queued);
    await mergeProductMirror(
      STORE,
      [{ ...product("p1", "Milk 1L", 15), _barcodes: ["222"] }],
      { p1: "v2" },
    );
    expect(await localFindByBarcode(STORE, "111")).toBeNull();
    expect((await localFindByBarcode(STORE, "222"))?.quantity).toBe(13);
    expect(await localSearch(STORE, "Bread")).toEqual([]);
    expect(
      (await listQueuedSales(STORE)).find((s) => s.id === queued.id),
    ).toBeDefined();
    await removeQueuedSale(queued.id);
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
    id: "s1",
    storeId: STORE,
    items: [{ product_id: "p1", quantity: 2, unit_price: 10 }],
    total: 20,
    createdAt: Date.now(),
    status: "pending",
  };

  it("enqueues, lists, updates status, and removes", async () => {
    await enqueueSale(sale);
    let rows = await listQueuedSales(STORE);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pending");

    await updateQueuedSale("s1", {
      status: "failed",
      error: "INSUFFICIENT_STOCK",
    });
    rows = await listQueuedSales(STORE);
    expect(rows[0].status).toBe("failed");
    expect(rows[0].error).toContain("INSUFFICIENT");

    await removeQueuedSale("s1");
    expect(await listQueuedSales(STORE)).toHaveLength(0);
  });
});

it("queues payment details and adjusts stock once across repeated offline saves", async () => {
  await replaceProductMirror(STORE, [product("atomic", "Atomic", 10)], []);
  const sale: QueuedSale = {
    id: "atomic-sale",
    actorId: "cashier",
    storeId: STORE,
    items: [{ product_id: "atomic", quantity: 2, unit_price: 10 }],
    total: 20,
    payments: [{ method: "CASH", amount: 50 }],
    createdAt: Date.now(),
    status: "pending",
  };
  await Promise.all([enqueueSaleAndAdjust(sale), enqueueSaleAndAdjust(sale)]);
  expect((await localSearch(STORE, "Atomic"))[0].quantity).toBe(8);
  expect(
    (await listQueuedSales(STORE)).find((s) => s.id === sale.id)?.payments,
  ).toEqual(sale.payments);
  await removeQueuedSale(sale.id);
});

it("queues sales-only quantities without inventing physical stock", async () => {
  await replaceProductMirror(
    STORE,
    [
      { ...product("kota", "KOTA", 0), tracking_type: "SALES_ONLY" },
      { ...product("linked-case", "KOTA case", 5), bulk_parent_id: "kota" },
    ],
    [],
  );
  const sale: QueuedSale = {
    id: "sales-only",
    storeId: STORE,
    items: [{ product_id: "kota", quantity: 2, unit_price: 35 }],
    total: 70,
    createdAt: Date.now(),
    status: "pending",
  };
  await enqueueSaleAndAdjust(sale);
  await localAdjustQuantity("kota", -2);
  const products = await localSearch(STORE, "");
  expect(products.map((p) => p.id)).toEqual(["kota"]);
  expect(products[0].quantity).toBe(0);
  expect(
    (await listQueuedSales(STORE)).find((s) => s.id === sale.id)?.items[0]
      .quantity,
  ).toBe(2);
  await removeQueuedSale(sale.id);
});
