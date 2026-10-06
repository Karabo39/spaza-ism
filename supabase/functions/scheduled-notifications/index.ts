import { jsPDF } from "npm:jspdf@4.2.1";
import { autoTable } from "npm:jspdf-autotable@5.0.8";
import { decodeDocumentLogo, logoSize } from "../_shared/document-logo.ts";
import { notificationDocumentSections, notificationHtml } from "./handler.ts";
import nodemailer from "npm:nodemailer@10.0.3";
import { smtpOptions, sendSmtp } from "../_shared/smtp.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.4";
import { notificationHandler } from "./handler.ts";
const smtp = smtpOptions((key) => Deno.env.get(key));
const sender =
  Deno.env.get("NOTIFICATION_EMAIL_FROM")?.trim() ||
  Deno.env.get("REPORT_EMAIL_FROM")?.trim();
const secret = Deno.env.get("NOTIFICATION_CRON_SECRET") ?? "";
const url = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const handler = notificationHandler({
  secret,
  authenticate: (p_secret) =>
    createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }).rpc("authenticate_recurring_worker", { p_secret }),
  configured: !!(smtp && sender && url && serviceKey),
  claim: () =>
    createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }).rpc("claim_notification_deliveries", { p_limit: 10 }),
  complete: (id, sent, provider, error) =>
    createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }).rpc("complete_notification_delivery", {
      p_delivery: id,
      p_sent: sent,
      p_provider: provider ?? null,
      p_error: error ?? null,
    }),
  send: async (job, message) => {
    const db = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    if (!smtp) throw new Error("SMTP_NOT_CONFIGURED");
    const authorized = await db.rpc("scheduled_notification_authorized", {
      p_delivery: job.id,
    });
    if (authorized.error || !authorized.data)
      throw new Error("Schedule inactive or access revoked");
    const sections = notificationDocumentSections(job);
    const landscape = sections.some((section) => section.columns.length > 5);
    const doc = new jsPDF({ orientation: landscape ? "landscape" : "portrait", unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    let logo: ReturnType<typeof decodeDocumentLogo> | undefined;
    if (job.payload.business_id) {
      const business = await db
        .from("businesses")
        .select("document_logo_path")
        .eq("id", job.payload.business_id)
        .single();
      if (business.error) throw business.error;
      if (business.data.document_logo_path) {
        const asset = await db.storage
          .from("document-logos")
          .download(business.data.document_logo_path);
        if (asset.error) throw asset.error;
        logo = decodeDocumentLogo(
          new Uint8Array(await asset.data.arrayBuffer()),
        );
      }
    }
    const period = job.payload.from && job.payload.to ? `${job.payload.from} to ${job.payload.to}` : "";
    const drawPageHeader = (pageNumber: number) => {
      if (logo) {
        const size = logoSize(logo, 45, 20);
        doc.addImage(logo.dataUrl, "PNG", 14, 7, size.width, size.height);
      }
      doc.setTextColor(24, 44, 77);
      doc.setFontSize(14);
      doc.text(doc.splitTextToSize(message.subject, pageWidth - 28), 14, 31);
      doc.setFontSize(8);
      doc.setTextColor(82, 98, 118);
      const metadata = [job.payload.business, job.payload.store, job.payload.currency, period].filter(Boolean).join(" · ");
      doc.text(doc.splitTextToSize(metadata, pageWidth - 28), 14, 38);
      doc.setDrawColor(217, 224, 232);
      doc.line(14, 44, pageWidth - 14, 44);
      doc.text(`${job.payload.business} · ${job.payload.store} · Page ${pageNumber}`, 14, pageHeight - 8);
    };
    let y = 52;
    if (!sections.length) {
      doc.setFontSize(10);
      doc.text("No report data for this period.", 14, y);
    }
    for (const section of sections) {
      if (y > pageHeight - 24) { doc.addPage(); y = 52; }
      doc.setFontSize(10);
      doc.setTextColor(24, 44, 77);
      doc.text(section.title, 14, y);
      autoTable(doc, {
        startY: y + 3,
        margin: { top: 48, bottom: 14, left: 14, right: 14 },
        head: [section.columns.map((column) => column.label)],
        body: section.rows.map((row) => section.columns.map((column) => String(row[column.key] ?? "—"))),
        styles: { fontSize: landscape ? 7 : 8, cellPadding: 2, overflow: "linebreak", valign: "top" },
        headStyles: { fillColor: [24, 44, 77], textColor: [255, 255, 255] },
        alternateRowStyles: { fillColor: [244, 247, 250] },
        horizontalPageBreak: true,
        horizontalPageBreakRepeat: 0,
        showHead: "everyPage",
        didDrawPage: (data) => drawPageHeader(data.pageNumber),
      });
      y = ((doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 12) + 9;
    }
    const pdf = doc.output("datauristring").split(",")[1];
    const transport = nodemailer.createTransport(smtp);
    try {
      const result = await sendSmtp(
        `notification-${job.id}`,
        {
          from: sender!,
          to: [job.recipient],
          ...message,
          html: notificationHtml(job),
          attachments: [{ filename: "scheduled-report.pdf", content: pdf }],
        },
        {
          begin: async (p_key) => {
            const { data, error } = await db.rpc("smtp_delivery", { p_key });
            if (error) throw new Error("SMTP_RESERVATION_FAILED");
            return data;
          },
          finish: async (p_key, p_token, p_provider) => {
            const { error } = await db.rpc("smtp_delivery", {
              p_key,
              p_token,
              p_provider,
            });
            if (error) throw new Error("SMTP_RECORD_FAILED");
          },
        },
        (message) => transport.sendMail(message),
      );
      return result;
    } finally {
      transport.close();
    }
  },
  pause: () => new Promise((resolve) => setTimeout(resolve, 600)),
});
Deno.serve(handler);
