import { logoSize, type DocumentLogo } from "@/lib/document-logo";
import {
  exportRow,
  displayReportValue,
  reportColumns,
  summaryLabels,
  type DeliveryReportPage,
} from "./report-data";
export type DeliveryExport = DeliveryReportPage & {
  business: string;
  filters: string;
  logo: DocumentLogo | null;
};
export async function deliveryExcel(data: DeliveryExport) {
  const { default: ExcelJS } = await import("exceljs");
  const book = new ExcelJS.Workbook();
  book.creator = "POS INVENTORY";
  const summary = book.addWorksheet("Summary");
  summary.addRow(["Delivery Report", data.business]);
  summary.addRow(["Generated", data.generated_at]);
  summary.addRow(["Filters", data.filters]);
  summary.getColumn(1).width = 30;
  summary.getColumn(2).width = 85;
  summary.getColumn(2).alignment = { wrapText: true };
  for (const [key, label] of Object.entries(summaryLabels))
    summary.addRow([
      label,
      data.summary?.[key as keyof typeof summaryLabels] ?? 0,
    ]);
  for (const value of data.summary?.values ?? [])
    summary.addRow([`Total Delivery Value (${value.currency})`, value.total]);
  summary.addRow([
    "Value basis",
    "Invoice order totals, including cancelled deliveries; not net revenue.",
  ]);
  if (data.logo) {
    summary.spliceRows(1, 0, []);
    summary.getRow(1).height = 75;
    const id = book.addImage({ base64: data.logo.dataUrl, extension: "png" });
    summary.addImage(id, {
      tl: { col: 0, row: 0 },
      ext: logoSize(data.logo, 160, 90),
    });
  }
  const sheet = book.addWorksheet("Deliveries", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.addRow(reportColumns.map((c) => c.label));
  for (const row of data.rows) {
    const r = exportRow(row);
    sheet.addRow(reportColumns.map((c) => r[c.key] ?? ""));
  }
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF182C4D" },
  };
  for (const [index, column] of reportColumns.entries()) {
    const c = sheet.getColumn(index + 1);
    c.width =
      column.key === "comments"
        ? 55
        : Math.min(35, Math.max(18, column.label.length + 3));
    c.alignment = { vertical: "top", wrapText: true };
    if (column.key === "order_total") c.numFmt = "#,##0.00";
  }
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: reportColumns.length },
  };
  return new Blob([new Uint8Array(await book.xlsx.writeBuffer()).buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
export async function deliveryPdf(data: DeliveryExport) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  function header(title: string) {
    if (data.logo) {
      const size = logoSize(data.logo, 40, 20);
      doc.addImage(data.logo.dataUrl, "PNG", 14, 8, size.width, size.height);
    }
    doc.setFontSize(16);
    doc.text(title, 14, data.logo ? 36 : 18);
    return data.logo ? 43 : 25;
  }
  const y = header("Delivery Report");
  autoTable(doc, {
    startY: y,
    head: [["Summary", "Count / Value"]],
    body: [
      ["Business", data.business],
      ["Generated", data.generated_at],
      ["Filters", data.filters],
      ...Object.entries(summaryLabels).map(([k, label]) => [
        label,
        String(data.summary?.[k as keyof typeof summaryLabels] ?? 0),
      ]),
      ...(data.summary?.values ?? []).map((v) => [
        `Total Delivery Value (${v.currency})`,
        Number(v.total).toFixed(2),
      ]),
      [
        "Value basis",
        "Invoice order totals, including cancelled deliveries. This is not net revenue.",
      ],
    ],
    styles: { fontSize: 10 },
    headStyles: { fillColor: [24, 44, 77] },
  });
  // Full details on readable pages, rather than squeezing 23 columns into tiny type.
  for (const row of data.rows) {
    doc.addPage();
    const start = header(row.delivery_number);
    const r = exportRow(row);
    autoTable(doc, {
      startY: start,
      head: [["Field", `Delivery details - ${row.delivery_number}`]],
      body: reportColumns
        .filter((c) => c.key !== "delivery_number")
        .map((c) => [c.label, displayReportValue(c.key, r[c.key])]),
      columnStyles: { 0: { cellWidth: 55 }, 1: { cellWidth: 127 } },
      styles: { fontSize: 9, cellPadding: 2.3, overflow: "linebreak" },
      headStyles: { fillColor: [24, 44, 77] },
      rowPageBreak: "avoid",
      margin: { bottom: 18, top: 15, left: 14, right: 14 },
    });
  }
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setFontSize(8);
    doc.text(
      `POS INVENTORY | ${page} / ${pages}`,
      14,
      doc.internal.pageSize.getHeight() - 8,
    );
  }
  return new Blob([doc.output("arraybuffer")], { type: "application/pdf" });
}
