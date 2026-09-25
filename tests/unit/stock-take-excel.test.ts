import { expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  createStockTakeWorkbook,
  readStockTakeWorkbook,
  type StockTakeTemplate,
} from "@/features/stock-take/excel";
const store = "10000000-0000-0000-0000-000000000001";
const template: StockTakeTemplate = {
  export_id: "20000000-0000-0000-0000-000000000001",
  store_id: store,
  stock_take_id: "30000000-0000-0000-0000-000000000001",
  store_name: "Test Store",
  items: [1, 2, 3].map((i) => ({
    id: `40000000-0000-0000-0000-00000000000${i}`,
    name: `Product ${i}`,
    sku: `00${i}`,
    unit: "each",
    quantity: 10,
  })),
};
async function filled(edit: (sheet: ExcelJS.Worksheet) => void) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await createStockTakeWorkbook(template));
  edit(book.getWorksheet("Stock Take")!);
  return new Uint8Array(await book.xlsx.writeBuffer()).buffer;
}
it("round-trips TRUE, zero and decimal counts; skips blank rows and leaves system counts authoritative", async () => {
  const buffer = await filled((s) => {
    s.getCell("G2").value = "true";
    s.getCell("E2").value = 999;
    s.getCell("F3").value = 0;
  });
  const result = await readStockTakeWorkbook(buffer, store);
  expect(result.rows).toEqual([
    { item_id: template.items[0].id, quantity: null, same: true, expiry: null },
    { item_id: template.items[1].id, quantity: 0, same: false, expiry: null },
  ]);
  const decimal = await readStockTakeWorkbook(
    await filled((s) => {
      s.getCell("F2").value = 1.125;
      s.getCell("H2").value = "2027-01-01";
    }),
    store,
  );
  expect(decimal.rows[0]).toMatchObject({
    quantity: 1.125,
    expiry: "2027-01-01",
  });
});
it("rejects another location or stock take", async () => {
  const data = await filled((s) => {
    s.getCell("F2").value = 1;
  });
  await expect(readStockTakeWorkbook(data, "another")).rejects.toThrow(
    "another location",
  );
  await expect(readStockTakeWorkbook(data, store, "another")).rejects.toThrow(
    "another location",
  );
});
it.each([-1, 1.1234, "NaN", "1e3", "5 apples", true])(
  "rejects invalid physical count %s",
  async (value) => {
    await expect(
      readStockTakeWorkbook(
        await filled((s) => {
          s.getCell("F2").value = value;
        }),
        store,
      ),
    ).rejects.toThrow("non-negative count");
  },
);
it("rejects formulas, conflicting TRUE, duplicates, bad expiry and changed headers", async () => {
  for (const edit of [
    (s: ExcelJS.Worksheet) => {
      s.getCell("F2").value = { formula: "1+1", result: 2 };
    },
    (s: ExcelJS.Worksheet) => {
      s.getCell("G2").value = true;
      s.getCell("F2").value = 2;
    },
    (s: ExcelJS.Worksheet) => {
      s.getCell("F2").value = 1;
      s.getCell("F3").value = 2;
      s.getCell("A3").value = s.getCell("A2").value;
    },
    (s: ExcelJS.Worksheet) => {
      s.getCell("F2").value = 1;
      s.getCell("H2").value = "2026-02-30";
    },
    (s: ExcelJS.Worksheet) => {
      s.getCell("F1").value = "Altered";
    },
  ])
    await expect(
      readStockTakeWorkbook(await filled(edit), store),
    ).rejects.toThrow();
});
