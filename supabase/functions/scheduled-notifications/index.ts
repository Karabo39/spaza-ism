import { jsPDF } from "npm:jspdf@4.2.1";
import { autoTable } from "npm:jspdf-autotable@5.0.8";
import { decodeDocumentLogo, logoSize } from "../_shared/document-logo.ts";
import { notificationHtml } from "./handler.ts";
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
    const doc = new jsPDF();
    let y = 18;
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
        const logo = decodeDocumentLogo(
          new Uint8Array(await asset.data.arrayBuffer()),
        );
        const size = logoSize(logo, 45, 24);
        doc.addImage(logo.dataUrl, "PNG", 14, 8, size.width, size.height);
        y = 42;
      }
    }
    doc.setFontSize(14);
    doc.text(doc.splitTextToSize(message.subject, 180), 14, y);
    y += 14;
    autoTable(doc, {
      startY: y,
      head: [["Scheduled report", "Details"]],
      body: message.text
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const at = line.indexOf(":");
          return at >= 0 ? [line.slice(0, at), line.slice(at + 1)] : [line, ""];
        }),
      styles: { fontSize: 9, overflow: "linebreak" },
      headStyles: { fillColor: [24, 44, 77] },
    });
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
