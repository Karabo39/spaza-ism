import type { Json, ProductStock } from "./db/database.types";

export type Cursor = { id: string; name?: string; created_at?: string };
export type DataPage<T> = { rows: T[]; next: Cursor | null };
export type CatalogProduct = ProductStock & {
  barcodes: string;
  nearest_expiry: string | null;
  expired_quantity: number;
  undated_quantity: number;
  sellable_quantity: number;
};
export function readCursor(value?: string): Cursor | null {
  if (!value || value.length > 2000) return null;
  try {
    const cursor = JSON.parse(value);
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        cursor.id,
      )
    )
      return null;
    if (typeof cursor.name === "string" && cursor.name.length <= 1000)
      return { id: cursor.id, name: cursor.name };
    if (
      typeof cursor.created_at === "string" &&
      !Number.isNaN(Date.parse(cursor.created_at))
    )
      return { id: cursor.id, created_at: cursor.created_at };
  } catch {
    /* Invalid cursors start at the first page. */
  }
  return null;
}
export function dataPage<T>(data: Json | null): DataPage<T> {
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    !Array.isArray(data.rows)
  )
    throw new Error("Invalid page response");
  return data as unknown as DataPage<T>;
}

/** Exports traverse bounded pages only after an explicit user action. */
export async function collectPages<T>(
  load: (after: Cursor | null) => Promise<DataPage<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  let after: Cursor | null = null;
  const seen = new Set<string>();
  do {
    const page = await load(after);
    rows.push(...page.rows);
    after = page.next;
    if (after) {
      const key = JSON.stringify(after);
      if (seen.has(key)) throw new Error("Export cursor did not advance");
      seen.add(key);
    }
  } while (after);
  return rows;
}
