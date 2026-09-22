"use client";
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { ProductStock } from "@/lib/db/database.types";

/**
 * Local, per-device mirror used for offline operation:
 *   • `products`  — v_product_stock rows for lookup/search while offline
 *   • `barcodes`  — barcode -> product mapping
 *   • `salesQueue`— cash sales captured offline, replayed on reconnect
 *   • `meta`      — last sync timestamps
 * The server remains the single source of truth; this is a cache + outbox.
 */

export type QueuedSale = {
  actorId?: string;
  payments?: import("@/features/goods-out/payments").Payment[];
  till?: string;
  id: string;
  storeId: string;
  items: { product_id: string; quantity: number; unit_price: number }[];
  total: number;
  createdAt: number;
  status: "pending" | "failed";
  error?: string;
};

interface SpazaDB extends DBSchema {
  products: {
    key: string;
    value: ProductStock & { _store: string };
    indexes: { by_store: string; by_sku: [string, string] };
  };
  barcodes: {
    key: [string, string];
    value: { barcode: string; product_id: string; store_id: string };
    indexes: { by_store: string; by_product: [string, string] };
  };
  salesQueue: { key: string; value: QueuedSale; indexes: { by_store: string } };
  meta: { key: string; value: { key: string; value: number | string } };
}

let dbPromise: Promise<IDBPDatabase<SpazaDB>> | null = null;

function getDB() {
  if (typeof indexedDB === "undefined") return null;
  if (!dbPromise) {
    // Keep the original database name so the POS INVENTORY rebrand retains queued sales.
    dbPromise = openDB<SpazaDB>("spaza-ism", 2, {
      async upgrade(db, oldVersion, _newVersion, tx) {
        // Read the old cache inside the upgrade transaction before changing its key.
        // This retains barcode lookup even if the first online sync fails.
        const oldBarcodes =
          oldVersion >= 1 ? await tx.objectStore("barcodes").getAll() : [];
        if (oldVersion < 1) {
          const p = db.createObjectStore("products", { keyPath: "id" });
          p.createIndex("by_store", "_store");
          const s = db.createObjectStore("salesQueue", { keyPath: "id" });
          s.createIndex("by_store", "storeId");
          db.createObjectStore("meta", { keyPath: "key" });
        }
        // Only the barcode cache is rebuilt; the durable sales outbox is retained.
        if (db.objectStoreNames.contains("barcodes"))
          db.deleteObjectStore("barcodes");
        const b = db.createObjectStore("barcodes", {
          keyPath: ["store_id", "barcode"],
        });
        b.createIndex("by_store", "store_id");
        b.createIndex("by_product", ["store_id", "product_id"]);
        tx.objectStore("products").createIndex("by_sku", ["_store", "sku"]);
        await Promise.all(oldBarcodes.map((barcode) => b.put(barcode)));
      },
    });
  }
  return dbPromise;
}

// ---------- product mirror ----------

export async function replaceProductMirror(
  storeId: string,
  products: ProductStock[],
  barcodes: { barcode: string; product_id: string; store_id: string }[],
) {
  const db = await getDB();
  if (!db) return;
  const tx = db.transaction(["products", "barcodes", "meta"], "readwrite");
  const pStore = tx.objectStore("products");
  const bStore = tx.objectStore("barcodes");

  // Clear this store's existing rows, then write fresh.
  for (const key of await pStore.index("by_store").getAllKeys(storeId))
    await pStore.delete(key);
  for (const key of await bStore.index("by_store").getAllKeys(storeId))
    await bStore.delete(key);
  for (const p of products) await pStore.put({ ...p, _store: storeId });
  for (const b of barcodes) await bStore.put(b);
  await tx
    .objectStore("meta")
    .put({ key: `sync:${storeId}`, value: Date.now() });
  await tx.done;
}

export async function localFindByBarcode(
  storeId: string,
  code: string,
): Promise<ProductStock | null> {
  const db = await getDB();
  if (!db) return null;
  const bc = await db.get("barcodes", [storeId, code.trim()]);
  if (bc && bc.store_id === storeId) {
    const p = await db.get("products", bc.product_id);
    if (p?.is_active && p._store === storeId) return p;
  }
  // Fall back to SKU/name exact match.
  const hit = await db.getFromIndex("products", "by_sku", [
    storeId,
    code.trim(),
  ]);
  return hit?.is_active ? hit : null;
}

export async function localFindById(id: string): Promise<ProductStock | null> {
  const db = await getDB();
  if (!db) return null;
  return (await db.get("products", id)) ?? null;
}

export async function localSearch(
  storeId: string,
  term: string,
  itemType?: "Individual" | "Bulk Stock",
): Promise<ProductStock[]> {
  const db = await getDB();
  if (!db) return [];
  const t = term.trim().toLowerCase();
  const result: ProductStock[] = [];
  let cursor = await db
    .transaction("products")
    .store.index("by_store")
    .openCursor(storeId);
  while (cursor && result.length < 20) {
    const p = cursor.value;
    const matchingType =
      itemType === "Bulk Stock" ? !!p.bulk_parent_id : !p.bulk_parent_id;
    if (
      p.is_active &&
      matchingType &&
      (!t ||
        p.name.toLowerCase().includes(t) ||
        (p.sku ?? "").toLowerCase().includes(t))
    )
      result.push(p);
    cursor = await cursor.continue();
  }
  return result;
}

/** Optimistically reduce a mirrored quantity after an offline sale. */
export async function localAdjustQuantity(productId: string, delta: number) {
  const db = await getDB();
  if (!db) return;
  const p = await db.get("products", productId);
  if (!p || p.tracking_type === "SALES_ONLY") return;
  p.quantity = Math.max(0, Number(p.quantity) + delta);
  await db.put("products", p);
}

export async function lastSync(storeId: string): Promise<number | null> {
  const db = await getDB();
  if (!db) return null;
  const m = await db.get("meta", `sync:${storeId}`);
  return typeof m?.value === "number" ? m.value : null;
}

export type MirrorProduct = ProductStock & { _barcodes: string[] };
export async function mirrorVersions(
  storeId: string,
): Promise<Record<string, string>> {
  const db = await getDB();
  const value = db && (await db.get("meta", `versions:${storeId}`))?.value;
  if (typeof value !== "string") return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

/** Commit a complete manifest and changed rows atomically; never discard queued sales. */
export async function mergeProductMirror(
  storeId: string,
  products: MirrorProduct[],
  versions: Record<string, string>,
) {
  const db = await getDB();
  if (!db) return;
  const tx = db.transaction(
    ["products", "barcodes", "meta", "salesQueue"],
    "readwrite",
  );
  const pStore = tx.objectStore("products"),
    bStore = tx.objectStore("barcodes");
  const reserved = new Map<string, number>();
  for (const sale of await tx
    .objectStore("salesQueue")
    .index("by_store")
    .getAll(storeId)) {
    for (const item of sale.items)
      reserved.set(
        item.product_id,
        (reserved.get(item.product_id) ?? 0) + item.quantity,
      );
  }
  const changed = new Set(products.map((p) => p.id));
  for (const key of await pStore.index("by_store").getAllKeys(storeId)) {
    if (!versions[key]) {
      await pStore.delete(key);
      changed.add(key);
    }
  }
  for (const key of changed) {
    const keys = await bStore.index("by_product").getAllKeys([storeId, key]);
    await Promise.all(keys.map((k) => bStore.delete(k)));
  }
  await Promise.all(
    products.map(async ({ _barcodes, ...p }) => {
      await pStore.put({
        ...p,
        _store: storeId,
        quantity:
          p.tracking_type === "SALES_ONLY"
            ? p.quantity
            : Math.max(0, Number(p.quantity) - (reserved.get(p.id) ?? 0)),
      });
      await Promise.all(
        _barcodes.map((barcode) =>
          bStore.put({ barcode, store_id: storeId, product_id: p.id }),
        ),
      );
    }),
  );
  // A queue entry may have been removed while this manifest was in flight.
  // Do not overwrite its invalidation unless we actually fetched that product.
  const currentMeta = await tx.objectStore("meta").get(`versions:${storeId}`);
  const currentVersions: Record<string, string> =
    typeof currentMeta?.value === "string" ? JSON.parse(currentMeta.value) : {};
  const committedVersions = { ...versions };
  for (const id of Object.keys(committedVersions)) {
    if (!changed.has(id) && !currentVersions[id]) delete committedVersions[id];
  }
  await tx
    .objectStore("meta")
    .put({
      key: `versions:${storeId}`,
      value: JSON.stringify(committedVersions),
    });
  await tx
    .objectStore("meta")
    .put({ key: `sync:${storeId}`, value: Date.now() });
  await tx.done;
}

// ---------- sales outbox ----------

export async function enqueueSale(sale: QueuedSale) {
  const db = await getDB();
  if (!db) return;
  await db.put("salesQueue", sale);
}

export async function listQueuedSales(storeId?: string): Promise<QueuedSale[]> {
  const db = await getDB();
  if (!db) return [];
  const rows = storeId
    ? await db.getAllFromIndex("salesQueue", "by_store", storeId)
    : await db.getAll("salesQueue");
  return rows.sort((a, b) => a.createdAt - b.createdAt);
}

export async function updateQueuedSale(id: string, patch: Partial<QueuedSale>) {
  const db = await getDB();
  if (!db) return;
  const cur = await db.get("salesQueue", id);
  if (cur) await db.put("salesQueue", { ...cur, ...patch });
}

export async function removeQueuedSale(id: string) {
  const db = await getDB();
  if (!db) return;
  const tx = db.transaction(["salesQueue", "meta"], "readwrite");
  const sale = await tx.objectStore("salesQueue").get(id);
  await tx.objectStore("salesQueue").delete(id);
  if (sale) {
    // Discarding a failed sale releases a local reservation even when the
    // server's product version has not changed. Reconcile it on the next sync.
    const key = `versions:${sale.storeId}`;
    const meta = await tx.objectStore("meta").get(key);
    if (typeof meta?.value === "string") {
      const versions: Record<string, string> = JSON.parse(meta.value);
      for (const item of sale.items) delete versions[item.product_id];
      await tx
        .objectStore("meta")
        .put({ key, value: JSON.stringify(versions) });
    }
  }
  await tx.done;
}

/** Persist the outbox entry and mirrored quantities together, exactly once. */
export async function enqueueSaleAndAdjust(sale: QueuedSale): Promise<void> {
  const pending = getDB();
  if (!pending) throw new Error("Offline storage unavailable");
  const db = await pending;
  const tx = db.transaction(["salesQueue", "products"], "readwrite");
  const existing = await tx.objectStore("salesQueue").get(sale.id);
  if (!existing) {
    await tx.objectStore("salesQueue").add(sale);
    for (const item of sale.items) {
      const product = await tx.objectStore("products").get(item.product_id);
      if (
        product &&
        product._store === sale.storeId &&
        product.tracking_type !== "SALES_ONLY"
      )
        await tx.objectStore("products").put({
          ...product,
          quantity: Math.max(0, Number(product.quantity) - item.quantity),
        });
    }
  }
  await tx.done;
}
