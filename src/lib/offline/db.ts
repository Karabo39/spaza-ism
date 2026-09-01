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
  id: string;
  storeId: string;
  items: { product_id: string; quantity: number; unit_price: number }[];
  total: number;
  createdAt: number;
  status: "pending" | "failed";
  error?: string;
};

interface SpazaDB extends DBSchema {
  products: { key: string; value: ProductStock & { _store: string }; indexes: { by_store: string } };
  barcodes: { key: string; value: { barcode: string; product_id: string; store_id: string }; indexes: { by_store: string } };
  salesQueue: { key: string; value: QueuedSale; indexes: { by_store: string } };
  meta: { key: string; value: { key: string; value: number } };
}

let dbPromise: Promise<IDBPDatabase<SpazaDB>> | null = null;

function getDB() {
  if (typeof indexedDB === "undefined") return null;
  if (!dbPromise) {
    dbPromise = openDB<SpazaDB>("spaza-ism", 1, {
      upgrade(db) {
        const p = db.createObjectStore("products", { keyPath: "id" });
        p.createIndex("by_store", "_store");
        const b = db.createObjectStore("barcodes", { keyPath: "barcode" });
        b.createIndex("by_store", "store_id");
        const s = db.createObjectStore("salesQueue", { keyPath: "id" });
        s.createIndex("by_store", "storeId");
        db.createObjectStore("meta", { keyPath: "key" });
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
  for (const key of await pStore.index("by_store").getAllKeys(storeId)) await pStore.delete(key);
  for (const key of await bStore.index("by_store").getAllKeys(storeId)) await bStore.delete(key);
  for (const p of products) await pStore.put({ ...p, _store: storeId });
  for (const b of barcodes) await bStore.put(b);
  await tx.objectStore("meta").put({ key: `sync:${storeId}`, value: Date.now() });
  await tx.done;
}

export async function localFindByBarcode(storeId: string, code: string): Promise<ProductStock | null> {
  const db = await getDB();
  if (!db) return null;
  const bc = await db.get("barcodes", code.trim());
  if (bc && bc.store_id === storeId) {
    const p = await db.get("products", bc.product_id);
    if (p) return p;
  }
  // Fall back to SKU/name exact match.
  const all = await db.getAllFromIndex("products", "by_store", storeId);
  const hit = all.find((p) => p.sku === code.trim());
  return hit ?? null;
}

export async function localFindById(id: string): Promise<ProductStock | null> {
  const db = await getDB();
  if (!db) return null;
  return (await db.get("products", id)) ?? null;
}

export async function localSearch(storeId: string, term: string): Promise<ProductStock[]> {
  const db = await getDB();
  if (!db) return [];
  const all = await db.getAllFromIndex("products", "by_store", storeId);
  const t = term.trim().toLowerCase();
  return (t ? all.filter((p) => p.name.toLowerCase().includes(t)) : all)
    .filter((p) => p.is_active)
    .slice(0, 20);
}

/** Optimistically reduce a mirrored quantity after an offline sale. */
export async function localAdjustQuantity(productId: string, delta: number) {
  const db = await getDB();
  if (!db) return;
  const p = await db.get("products", productId);
  if (!p) return;
  p.quantity = Math.max(0, Number(p.quantity) + delta);
  await db.put("products", p);
}

export async function lastSync(storeId: string): Promise<number | null> {
  const db = await getDB();
  if (!db) return null;
  const m = await db.get("meta", `sync:${storeId}`);
  return m?.value ?? null;
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
  await db.delete("salesQueue", id);
}
