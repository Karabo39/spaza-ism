// @vitest-environment node
import { expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  importCell,
  importColumns,
  importTemplate,
  parseImport,
} from "@/features/imports/import-format";
it("round trips an editable product workbook and preserves zeroes and barcodes", async () => {
  const blob = await importTemplate("products", [
    {
      name: "Soap",
      barcode: "000123",
      quantity: 0,
      cost_price: 12.34,
      track_expiry: false,
    },
  ]);
  expect(await parseImport("products", await blob.arrayBuffer())).toEqual([
    {
      name: "Soap",
      barcode: "000123",
      quantity: 0,
      cost_price: 12.34,
      track_expiry: false,
    },
  ]);
});
it("preserves blank fields, rejects formula cells and refuses numeric identifiers", () => {
  expect(importCell("quantity", "")).toBeUndefined();
  expect(importCell("is_active", "FALSE")).toBe(false);
  expect(() => importCell("quantity", { formula: "1+1", result: 2 })).toThrow(
    "plain values",
  );
  expect(() => importCell("barcode", 123)).toThrow("Text");
  expect(() => importCell("cost_price", 1.234)).toThrow("2 decimal");
  expect(() => importCell("expiry_date", "2026-02-30")).toThrow("YYYY-MM-DD");
});
it("requires matching template headers and enforces the 200-record limit", async () => {
  const blob = await importTemplate("suppliers", [{ name: "Wholesale" }]);
  await expect(
    parseImport("customers", await blob.arrayBuffer()),
  ).rejects.toThrow("Headers");
  const large = await importTemplate(
    "customers",
    Array.from({ length: 201 }, (_, i) => ({ name: `Customer ${i}` })),
  );
  await expect(
    parseImport("customers", await large.arrayBuffer()),
  ).rejects.toThrow("200");
});
it("reports the Excel row containing a formula", async () => {
  const workbook = new ExcelJS.Workbook(),
    sheet = workbook.addWorksheet("Data");
  sheet.addRow(importColumns.customers);
  sheet.addRow([
    null,
    "Customer",
    null,
    null,
    null,
    { formula: "100*2", result: 200 },
  ]);
  const buffer = new Uint8Array(await workbook.xlsx.writeBuffer()).buffer;
  await expect(parseImport("customers", buffer)).rejects.toThrow("Row 2");
});
