import { BRAND_NAME } from "@/lib/brand";
import type { CellValue } from "exceljs";
export type ImportKind = "products" | "suppliers" | "customers";
export type ImportRow = Record<string, string | number | boolean>;
export const importColumns: Record<ImportKind, string[]> = {
  products: [
    "id",
    "name",
    "barcode",
    "sku",
    "unit",
    "cost_price",
    "selling_price",
    "min_stock_level",
    "reorder_level",
    "quantity",
    "track_expiry",
    "expiry_date",
    "is_active",
  ],
  suppliers: [
    "id",
    "name",
    "contact_name",
    "phone",
    "email",
    "address",
    "notes",
    "is_active",
  ],
  customers: [
    "id",
    "name",
    "phone",
    "email",
    "notes",
    "credit_limit",
    "is_active",
  ],
};
const numeric = new Set([
  "cost_price",
  "selling_price",
  "min_stock_level",
  "reorder_level",
  "quantity",
  "credit_limit",
]);
const booleans = new Set(["track_expiry", "is_active"]);
export function importCell(
  key: string,
  value: CellValue,
): string | number | boolean | undefined {
  if (
    value === null ||
    value === undefined ||
    (typeof value === "string" && !value.trim())
  )
    return;
  if (key === "expiry_date" && value instanceof Date)
    return value.toISOString().slice(0, 10);
  if (typeof value === "object")
    throw new Error(
      "Use plain values; formulas, links and rich text are not imported.",
    );
  if (numeric.has(key)) {
    const n = Number(value),
      decimals = ["cost_price", "selling_price", "credit_limit"].includes(key)
        ? 2
        : 3;
    if (
      typeof value === "boolean" ||
      !Number.isFinite(n) ||
      n < 0 ||
      n >= 1e10 ||
      Math.abs(n * 10 ** decimals - Math.round(n * 10 ** decimals)) > 0.00001
    )
      throw new Error(
        `${key}: use a positive number or zero, with at most ${decimals} decimal places.`,
      );
    return n;
  }
  if (booleans.has(key)) {
    if (typeof value === "boolean") return value;
    if (String(value).toLowerCase() === "true") return true;
    if (String(value).toLowerCase() === "false") return false;
    throw new Error(`${key}: enter TRUE or FALSE.`);
  }
  if (["id", "barcode", "phone"].includes(key) && typeof value !== "string")
    throw new Error(
      `${key}: format the cell as Text to preserve its exact value.`,
    );
  const text = String(value).trim();
  if (text.length > 1000) throw new Error(`${key}: maximum 1,000 characters.`);
  if (
    key === "id" &&
    !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(text)
  )
    throw new Error("id: use an ID from the existing-records download.");
  if (
    key === "expiry_date" &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(text) ||
      !Number.isFinite(Date.parse(text)) ||
      new Date(text).toISOString().slice(0, 10) !== text)
  )
    throw new Error("expiry_date: use YYYY-MM-DD.");
  return text;
}
export async function importTemplate(
  kind: ImportKind,
  rows: Record<string, unknown>[] = [],
): Promise<Blob> {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook(),
    sheet = workbook.addWorksheet("Data", {
      views: [{ state: "frozen", ySplit: 1 }],
    });
  sheet.columns = importColumns[kind].map((key) => ({
    header: key,
    key,
    width: key === "name" ? 32 : 22,
    style: { numFmt: numeric.has(key) ? "0.###" : "@" },
  }));
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF182C4D" },
  };
  for (const row of rows)
    sheet.addRow(
      Object.fromEntries(
        importColumns[kind].map((key) => [key, row[key] ?? null]),
      ),
    );
  const help = workbook.addWorksheet("Instructions");
  help.getColumn(1).width = 120;
  [
    `${BRAND_NAME} import · edit the Data sheet; maximum 200 non-empty rows.`,
    "Keep headers unchanged. Blank cells preserve existing values. Zero is an explicit value.",
    "A blank ID creates a record. Products also match an existing active barcode at the selected location.",
    "Use the existing-records download for updates. Suppliers are shared across the business; products and customers belong to the selected location.",
    "Keep ID, barcode and phone cells as Text. Do not use formulas. Dates: YYYY-MM-DD. Booleans: TRUE or FALSE.",
    "Product quantity is the new total on hand, not stock to add. Leave it blank to keep current stock.",
    "Expiry-tracked stock increases require expiry_date. Unit and expiry tracking changes on existing products require manual review.",
    "New product prices and quantity default to zero, unit to each, active to TRUE and expiry tracking to FALSE.",
    "Customer credit_limit changes the limit only. Balances and financial transactions are never imported.",
    "Review the preview before confirming. An import either succeeds in full or changes nothing.",
  ].forEach((line) => help.addRow([line]));
  return new Blob([new Uint8Array(await workbook.xlsx.writeBuffer()).buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
export async function parseImport(
  kind: ImportKind,
  buffer: ArrayBuffer,
): Promise<ImportRow[]> {
  if (buffer.byteLength > 2_000_000)
    throw new Error("Use an Excel file smaller than 2 MB.");
  const { default: ExcelJS } = await import("exceljs"),
    workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet("Data");
  if (!sheet)
    throw new Error(
      "The workbook must contain the Data sheet from the template.",
    );
  const headers = importColumns[kind];
  if (
    sheet.columnCount !== headers.length ||
    headers.some((key, i) => sheet.getRow(1).getCell(i + 1).value !== key)
  )
    throw new Error(
      "Headers do not match this template. Download the correct template and keep its columns unchanged.",
    );
  const rows: ImportRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const item: ImportRow = {};
    for (let i = 0; i < headers.length; i++) {
      try {
        const value = importCell(headers[i], row.getCell(i + 1).value);
        if (value !== undefined) item[headers[i]] = value;
      } catch (error) {
        throw new Error(`Row ${rowNumber}: ${(error as Error).message}`);
      }
    }
    if (Object.keys(item).length) rows.push(item);
    if (rows.length > 200)
      throw new Error("Import at most 200 records at a time.");
  });
  if (!rows.length)
    throw new Error("Add records to the Data sheet before importing.");
  return rows;
}
