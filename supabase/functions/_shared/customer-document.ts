import type { jsPDF } from "jspdf";
import type { UserOptions } from "jspdf-autotable";

export type CustomerDocument = {
  type: string;
  customer: string;
  business: string;
  store: string;
  reference: string;
  related_reference?: string | null;
  date: string;
  due?: string | null;
  currency: string;
  summary: string;
  total: number;
  payment_status: string;
  outstanding?: number | null;
  address?: string | null;
  business_address?: string | null;
  business_contact?: string | null;
  logo_path?: string | null;
  lines: {
    description: string;
    quantity?: number;
    unit?: string;
    price?: number;
    amount?: number;
    balance?: number;
  }[];
  details?: Record<string, unknown>;
};

const escape = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function documentAmount(value: number, currency: string) {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency,
    currencyDisplay: "code",
    minimumFractionDigits: 2,
  })
    .format(Number(value))
    .replace(/\s/g, " ");
}
function valueText(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(valueText).join("; ");
  if (typeof value === "object")
    return Object.entries(value)
      .map(([key, v]) => `${key}: ${valueText(v)}`)
      .join(", ");
  return String(value);
}
function dateText(value: string) {
  // Date-only business dates must not be shifted through a browser time zone.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, " UTC");
}
export function documentFields(doc: CustomerDocument): [string, string][] {
  const fields: [string, string][] = [
    ["Customer", doc.customer],
    ["Business", doc.business],
    ["Document type", doc.type],
    ["Document number", doc.reference],
    ["Transaction date", dateText(doc.date)],
    ["Store", doc.store],
  ];
  if (doc.related_reference) fields.push(["Reference", doc.related_reference]);
  fields.push(
    ["Summary", doc.summary],
    ["Total amount", documentAmount(doc.total, doc.currency)],
    ["Payment status", doc.payment_status],
  );
  if (doc.outstanding != null)
    fields.push([
      "Outstanding amount",
      documentAmount(doc.outstanding, doc.currency),
    ]);
  if (doc.due)
    fields.push([
      doc.type === "Quotation" ? "Valid until" : "Payment due date",
      dateText(doc.due),
    ]);
  if (doc.address) fields.push(["Customer address", doc.address]);
  return fields;
}

/** All customer-controlled content is escaped, including table cells and subjects. */
export function customerEmail(doc: CustomerDocument) {
  const subject = `${doc.business} | ${doc.type} ${doc.reference}`
    .replace(/[\r\n\x00-\x1f]/g, " ")
    .slice(0, 240);
  const fields = documentFields(doc);
  const text = `Dear ${doc.customer},\n\nPlease find your ${doc.type.toLowerCase()} attached.\n\n${fields.map(([key, value]) => `${key}: ${value}`).join("\n")}\n\nThank you for your business.\n${doc.business}${doc.business_contact ? `\n${doc.business_contact}` : ""}\n\nThis email reflects the transaction when the document was prepared.`;
  const html = `<!doctype html><html><body style="margin:0;background:#f3f5f8;color:#172033;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:24px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:auto;background:#fff;border:1px solid #dce2eb;border-radius:8px"><tr><td style="padding:28px;background:#172b4d;color:#fff"><p style="margin:0 0 8px;font-size:13px;letter-spacing:1px">${escape(doc.business)}</p><h1 style="margin:0;font-size:24px">${escape(doc.type)}</h1><p style="margin:8px 0 0">${escape(doc.reference)}</p></td></tr><tr><td style="padding:28px"><p>Dear ${escape(doc.customer)},</p><p>Please find your ${escape(doc.type.toLowerCase())} attached.</p><table width="100%" cellpadding="8" cellspacing="0" style="border-collapse:collapse;font-size:14px">${fields.map(([key, value]) => `<tr><th align="left" valign="top" style="width:38%;border-bottom:1px solid #e8edf3">${escape(key)}</th><td style="border-bottom:1px solid #e8edf3;overflow-wrap:anywhere">${escape(value)}</td></tr>`).join("")}</table><p style="margin-top:24px">Thank you for your business.<br><strong>${escape(doc.business)}</strong></p>${doc.business_contact ? `<p>${escape(doc.business_contact)}</p>` : ""}<p style="font-size:12px;color:#617086">This email reflects the transaction when the document was prepared. Please refer to the attached document for the full details.</p></td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}

export function customerPdf(
  doc: CustomerDocument,
  pdf: jsPDF,
  table: (pdf: jsPDF, options: UserOptions) => void,
  logo?: { dataUrl: string; width: number; height: number } | null,
) {
  const logoHeight = logo ? Math.min(22, (logo.height / logo.width) * 44) : 0;
  const header = () => {
    if (logo)
      pdf.addImage(
        logo.dataUrl,
        "PNG",
        14,
        8,
        (logoHeight * logo.width) / logo.height,
        logoHeight,
      );
    pdf.setFontSize(10);
    pdf.text(
      pdf.splitTextToSize(`${doc.business} | ${doc.reference}`, 130),
      logo ? 65 : 14,
      14,
    );
  };
  pdf.setProperties({
    title: `${doc.type} ${doc.reference}`,
    author: doc.business,
  });
  table(pdf, {
    startY: 36,
    margin: { top: 36, bottom: 18 },
    didDrawPage: header,
    theme: "plain",
    styles: { fontSize: 10, overflow: "linebreak", cellPadding: 2 },
    columnStyles: { 0: { cellWidth: 45, fontStyle: "bold" } },
    body: [
      ...documentFields(doc),
      ...Object.entries(doc.details ?? {})
        .filter(([, v]) => v != null && v !== "")
        .map(([key, value]) => [key, valueText(value)]),
      ...(doc.business_address
        ? [["Business address", doc.business_address]]
        : []),
      ...(doc.business_contact
        ? [["Business contact", doc.business_contact]]
        : []),
    ],
  });
  const nextY =
    (pdf as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable
      .finalY + 8;
  const statement = doc.type === "Customer statement";
  table(pdf, {
    startY: nextY,
    margin: { top: 36, bottom: 18 },
    didDrawPage: header,
    head: [
      statement
        ? ["Transaction", "Amount", "Balance"]
        : ["Description", "Quantity / unit", "Unit price", "Amount"],
    ],
    body: (doc.lines ?? []).map((line) =>
      statement
        ? [
            line.description,
            line.amount == null
              ? ""
              : documentAmount(line.amount, doc.currency),
            line.balance == null
              ? ""
              : documentAmount(line.balance, doc.currency),
          ]
        : [
            line.description,
            line.quantity == null ? "" : `${line.quantity} ${line.unit ?? ""}`,
            line.price == null ? "" : documentAmount(line.price, doc.currency),
            line.amount == null
              ? ""
              : documentAmount(line.amount, doc.currency),
          ],
    ),
    theme: "striped",
    styles: { fontSize: 9, overflow: "linebreak", cellPadding: 3 },
    headStyles: { fillColor: [23, 43, 77] },
    columnStyles: { 0: { cellWidth: statement ? 115 : 80 } },
  });
  for (let page = 1; page <= pdf.getNumberOfPages(); page++) {
    pdf.setPage(page);
    pdf.setFontSize(8);
    pdf.text(`Page ${page} of ${pdf.getNumberOfPages()}`, 14, 289);
  }
  return pdf.output("datauristring").split(",")[1];
}
