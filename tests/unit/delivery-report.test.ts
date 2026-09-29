import { describe, it, expect, vi } from "vitest";
import {
  collectDeliveryReport,
  exportRow,
  reportArgs,
  type DeliveryReportPage,
  type DeliveryReportRow,
} from "@/features/deliveries/report-data";
import {
  deliveryExcel,
  deliveryPdf,
  type DeliveryExport,
} from "@/features/deliveries/report-export";
import { modulePermissions, moduleForPath } from "@/lib/modules";
const row: DeliveryReportRow = {
  sequence: 3,
  delivery_id: "delivery",
  order_id: "order",
  invoice_id: "invoice",
  store_id: "store",
  delivery_number: "DNN-20260929-001",
  order_number: "ORD-1",
  invoice_number: "INV-1",
  customer_name: "=1+1",
  customer_contact: "0111111111",
  store_name: "Main",
  driver_name: null,
  vehicle_registration: null,
  order_date: "2026-09-29",
  delivery_date: "2026-09-29",
  scheduled_date: "2026-10-01",
  delivery_status: "RESCHEDULED",
  order_total: 125.5,
  currency: "ZAR",
  payment_status: "PAID",
  attempt_count: 1,
  rescheduled_date: "2026-10-01",
  cancellation_reason: null,
  failure_reason: "Customer unavailable",
  confirmed_by: null,
  received_by: null,
  comments: "Call before arrival",
  delivered_at: null,
};
const page: DeliveryReportPage = {
  rows: [row],
  next: null,
  until: 3,
  generated_at: "2026-09-29T12:00:00Z",
  summary: {
    total: 1,
    delivered: 0,
    pending: 0,
    scheduled: 0,
    out_for_delivery: 0,
    rescheduled: 1,
    failed: 0,
    cancelled: 0,
    values: [{ currency: "ZAR", total: 125.5 }],
  },
};
describe("delivery report exports", () => {
  it("fetches all pages using the first watermark and retains full summary", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ ...page, next: 3 })
      .mockResolvedValueOnce({
        ...page,
        rows: [{ ...row, sequence: 2 }],
        summary: null,
      });
    const data = await collectDeliveryReport(fetch);
    expect(fetch.mock.calls).toEqual([
      [null, null],
      [3, 3],
    ]);
    expect(data.rows).toHaveLength(2);
    expect(data.summary?.total).toBe(1);
  });
  it("rejects a repeating cursor rather than looping forever", async () => {
    await expect(
      collectDeliveryReport(async () => ({ ...page, next: 3 })),
    ).rejects.toThrow("pagination did not advance");
  });
  it("passes the exact export mode and filters to the guarded RPC", () => {
    expect(reportArgs(["store"], { status: "FAILED" }, "pdf")).toMatchObject({
      p_mode: "pdf",
      p_limit: 200,
      p_filters: { status: "FAILED" },
    });
    expect(exportRow(row).delivery_status).toBe("Rescheduled");
  });
  it("uses independent report and output permissions", () => {
    const p = modulePermissions("employee", {
      reports: true,
      reports_delivery: true,
      reports_delivery_excel: false,
      orders_deliveries: false,
    });
    expect(p.reports_delivery).toBe(true);
    expect(p.reports_delivery_excel).toBe(false);
    expect(p.orders_deliveries).toBe(false);
    expect(moduleForPath("/reports/deliveries")).toBe("reports_delivery");
    const revoked = modulePermissions("employee", {
      reports_delivery: false,
      reports_delivery_pdf: true,
    });
    expect(revoked.reports_delivery_pdf).toBe(false);
  });
  it("writes numeric amounts, literal customer text and a separate summary sheet", async () => {
    const data: DeliveryExport = {
      ...page,
      business: "Demo",
      filters: "All branches",
      logo: null,
    };
    const blob = await deliveryExcel(data);
    const { default: ExcelJS } = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await blob.arrayBuffer());
    expect(workbook.getWorksheet("Summary")?.getRow(1).getCell(1).value).toBe(
      "Delivery Report",
    );
    const sheet = workbook.getWorksheet("Deliveries")!;
    expect(sheet.getRow(2).getCell(4).value).toBe("=1+1");
    expect(sheet.getRow(2).getCell(13).value).toBe(125.5);
    expect(sheet.rowCount).toBe(2);
  });
  it("creates a complete PDF even with no matching deliveries", async () => {
    const blob = await deliveryPdf({
      ...page,
      rows: [],
      business: "Demo",
      filters: "No matching deliveries",
      logo: null,
    });
    expect(
      new TextDecoder().decode((await blob.arrayBuffer()).slice(0, 5)),
    ).toBe("%PDF-");
  });
});
