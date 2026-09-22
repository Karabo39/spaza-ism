import "fake-indexeddb/auto";
import { openDB } from "idb";
import { expect, it } from "vitest";

it("upgrades the v1 mirror without losing barcodes, products or unsent sales", async () => {
  const previous = await openDB("spaza-ism", 1, {
    upgrade(db) {
      db.createObjectStore("products", { keyPath: "id" }).createIndex(
        "by_store",
        "_store",
      );
      db.createObjectStore("barcodes", { keyPath: "barcode" }).createIndex(
        "by_store",
        "store_id",
      );
      db.createObjectStore("salesQueue", { keyPath: "id" }).createIndex(
        "by_store",
        "storeId",
      );
      db.createObjectStore("meta", { keyPath: "key" });
    },
  });
  await previous.put("products", {
    id: "p1",
    _store: "s1",
    sku: "sku1",
    name: "Milk",
    is_active: true,
    quantity: 8,
  });
  await previous.put("barcodes", {
    barcode: "123",
    store_id: "s1",
    product_id: "p1",
  });
  await previous.put("salesQueue", {
    id: "sale1",
    storeId: "s1",
    status: "pending",
    createdAt: 1,
    items: [{ product_id: "p1", quantity: 2, unit_price: 10 }],
  });
  previous.close();
  const { localFindByBarcode, listQueuedSales } = await import(
    "@/lib/offline/db"
  );
  expect((await localFindByBarcode("s1", "123"))?.quantity).toBe(8);
  expect((await localFindByBarcode("s1", "sku1"))?.id).toBe("p1");
  expect((await listQueuedSales("s1"))[0]?.id).toBe("sale1");
});
