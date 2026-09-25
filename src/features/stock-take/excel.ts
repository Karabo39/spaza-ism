import ExcelJS from "exceljs";

export type StockTakeTemplate = {
  export_id: string;
  store_id: string;
  stock_take_id: string;
  store_name: string;
  items: {
    id: string;
    name: string;
    sku: string | null;
    unit: string;
    quantity: number;
  }[];
};
export type ImportedCount = {
  item_id: string;
  quantity: number | null;
  same: boolean;
  expiry: string | null;
};
const headers = [
  "Item ID",
  "Product",
  "SKU",
  "Unit",
  "System quantity",
  "Physical count",
  "Still the Same",
  "Added stock expiry",
];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function createStockTakeWorkbook(template: StockTakeTemplate) {
  const book = new ExcelJS.Workbook();
  const help = book.addWorksheet("Instructions");
  [
    "POS INVENTORY — Stock take",
    `Location: ${template.store_name}`,
    "Enter a Physical count, or set Still the Same to TRUE to use the exported system quantity.",
    "Leave both blank to skip a product. Counts accept up to three decimal places, including zero.",
    "For additional expiry-tracked stock, enter Added stock expiry as YYYY-MM-DD.",
    "Do not change Item IDs, system quantities or the Metadata sheet. Do not enter formulas.",
    "Pause stock movements while counting. Changed products require a new template and recount.",
    "Import saves counts only. A manager must review and approve before stock changes.",
  ].forEach((line) => help.addRow([line]));
  help.getColumn(1).width = 110;
  help.getRow(1).font = { bold: true, size: 16 };
  const meta = book.addWorksheet("Metadata");
  meta.addRows([
    ["Format", "POS-STOCK-TAKE-1"],
    ["Store ID", template.store_id],
    ["Stock take ID", template.stock_take_id],
    ["Export ID", template.export_id],
  ]);
  meta.state = "veryHidden";
  const sheet = book.addWorksheet("Stock Take", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.addRow(headers);
  template.items.forEach((item) => {
    const row = sheet.addRow([
      item.id,
      item.name,
      item.sku ?? "",
      item.unit,
      Number(item.quantity),
      null,
      null,
      null,
    ]);
    row.getCell(7).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"TRUE,FALSE"'],
      showErrorMessage: true,
      error: "Choose TRUE or FALSE.",
    };
    row.getCell(6).dataValidation = {
      type: "decimal",
      operator: "greaterThanOrEqual",
      formulae: [0],
      allowBlank: true,
      showErrorMessage: true,
      error: "Enter a non-negative count.",
    };
  });
  [38, 40, 20, 12, 20, 20, 20, 24].forEach((width, i) => {
    sheet.getColumn(i + 1).width = width;
  });
  sheet.getColumn(1).hidden = true;
  sheet.getColumn(8).numFmt = "@";
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF991B1B" },
  };
  sheet.autoFilter = { from: "A1", to: "H1" };
  book.views = [
    {
      activeTab: 2,
      firstSheet: 0,
      x: 0,
      y: 0,
      width: 1200,
      height: 800,
      visibility: "visible",
    },
  ];
  return book.xlsx.writeBuffer();
}

function scalar(
  cell: ExcelJS.Cell,
  row: number,
): string | number | boolean | Date | null {
  const value = cell.value;
  if (value === null || value === undefined) return null;
  if (typeof value === "object" && !(value instanceof Date))
    throw new Error(
      `Row ${row}: formulas and linked or formatted values are not supported. Enter plain values.`,
    );
  return value;
}
export async function readStockTakeWorkbook(
  buffer: ArrayBuffer,
  storeId: string,
  stockTakeId?: string,
) {
  if (buffer.byteLength > 10 * 1024 * 1024)
    throw new Error("The workbook must be smaller than 10 MB.");
  // Inspect uncompressed sizes before ExcelJS parses XML from an untrusted workbook.
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(buffer);
  let size = 0;
  for (const entry of Object.values(zip.files)) {
    const declared =
      (entry as unknown as { _data?: { uncompressedSize?: number } })._data
        ?.uncompressedSize ?? 0;
    size += declared;
    if (size > 40 * 1024 * 1024)
      throw new Error(
        "The workbook contains too much data. Use the original template.",
      );
  }
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer);
  const meta = book.getWorksheet("Metadata"),
    sheet = book.getWorksheet("Stock Take");
  if (!meta || !sheet || meta.getCell("B1").value !== "POS-STOCK-TAKE-1")
    throw new Error("Use a POS INVENTORY stock-take template.");
  const store = String(meta.getCell("B2").value),
    take = String(meta.getCell("B3").value),
    exportId = String(meta.getCell("B4").value);
  if (store !== storeId || (stockTakeId && take !== stockTakeId))
    throw new Error("This template belongs to another location or stock take.");
  if (!uuid.test(take) || !uuid.test(exportId))
    throw new Error("The template metadata is invalid.");
  if (sheet.rowCount > 10001)
    throw new Error("A template supports up to 10,000 products.");
  headers.forEach((label, i) => {
    if (sheet.getRow(1).getCell(i + 1).value !== label)
      throw new Error(
        "The template columns have changed. Download a new template.",
      );
  });
  const rows: ImportedCount[] = [],
    seen = new Set<string>();
  for (let i = 2; i <= sheet.rowCount; i++) {
    const row = sheet.getRow(i);
    const count = scalar(row.getCell(6), i),
      flag = scalar(row.getCell(7), i);
    const flagText = String(flag ?? "")
      .trim()
      .toUpperCase();
    if (!["", "TRUE", "FALSE"].includes(flagText))
      throw new Error(`Row ${i}: Still the Same must be TRUE or FALSE.`);
    const same = flagText === "TRUE",
      rawCount = String(count ?? "").trim();
    if (!same && !rawCount) continue;
    const id = String(scalar(row.getCell(1), i));
    if (!uuid.test(id) || seen.has(id))
      throw new Error(`Row ${i}: invalid or duplicate Item ID.`);
    seen.add(id);
    const system = Number(scalar(row.getCell(5), i));
    if (same && rawCount && Number(rawCount) !== system)
      throw new Error(
        `Row ${i}: clear Physical count or set Still the Same to FALSE.`,
      );
    const quantity = same ? null : Number(rawCount);
    if (
      !same &&
      (!/^\d+(\.\d{1,3})?$/.test(rawCount) ||
        !Number.isFinite(quantity) ||
        quantity! > 999999999.999)
    )
      throw new Error(
        `Row ${i}: enter a non-negative count with up to three decimal places.`,
      );
    const expiryValue = scalar(row.getCell(8), i);
    const expiry =
      expiryValue instanceof Date
        ? expiryValue.toISOString().slice(0, 10)
        : String(expiryValue ?? "").trim();
    if (
      expiry &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(expiry) ||
        Number.isNaN(Date.parse(expiry)) ||
        new Date(expiry).toISOString().slice(0, 10) !== expiry)
    )
      throw new Error(`Row ${i}: use YYYY-MM-DD for expiry.`);
    rows.push({ item_id: id, quantity, same, expiry: expiry || null });
  }
  if (!rows.length)
    throw new Error("Enter a count or TRUE for at least one product.");
  return { exportId, stockTakeId: take, rows };
}
