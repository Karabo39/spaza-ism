import nodemailer from "npm:nodemailer@10.0.3";
import { createClient } from "npm:@supabase/supabase-js@2.112.4";
import { jsPDF } from "npm:jspdf@4.2.1";
import { autoTable } from "npm:jspdf-autotable@5.0.8";
import { smtpOptions, sendSmtp } from "../_shared/smtp.ts";
import { recurringHandler } from "./handler.ts";
import { decodeDocumentLogo,logoSize } from "../_shared/document-logo.ts";
const smtp = smtpOptions((key) => Deno.env.get(key));
const from =
  Deno.env.get("INVOICE_EMAIL_FROM")?.trim() ||
  Deno.env.get("REPORT_EMAIL_FROM")?.trim();
const url = Deno.env.get("SUPABASE_URL") ?? "",
  key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
Deno.serve(
  recurringHandler({
    authenticate: (p_secret) =>
      db.rpc("authenticate_recurring_worker", { p_secret }),
    configured: !!(smtp && from && url && key),
    claim: () => db.rpc("claim_recurring_deliveries", { p_limit: 10 }),
    complete: (job, provider) =>
      db.rpc("complete_recurring_delivery", {
        p_invoice: job.id,
        p_token: job.token,
        p_provider: provider ?? null,
      }),
    send: async (job) => {
      const pdf = new jsPDF();
      let top=20;
      let logo: ReturnType<typeof decodeDocumentLogo>|null=null;
      if(job.logo_path){const asset=await db.storage.from("document-logos").download(job.logo_path);if(asset.error)throw asset.error;logo=decodeDocumentLogo(new Uint8Array(await asset.data.arrayBuffer()));top=42;}
      const amount = (n: number) =>
        new Intl.NumberFormat("en-ZA", {
          style: "currency",
          currency: job.currency,
        }).format(Number(n));
      pdf.setFontSize(15);
      pdf.text(`Invoice ${job.reference}`, 14, top);
      pdf.setFontSize(10);
      const heading = pdf.splitTextToSize(
        `${job.business} - ${job.store}\nCustomer: ${job.customer.name}\nAddress: ${job.customer.address || "Not provided"}\nInvoice date: ${job.date} | Due: ${job.due}`,
        180,
      );
      pdf.text(heading, 14, top+10);
      autoTable(pdf, {
        startY: top+15 + heading.length * 5,
        margin:{top:logo?40:18,bottom:18},
        didDrawPage:()=>{if(logo){const size=logoSize(logo,45,24);pdf.addImage(logo.dataUrl,"PNG",14,8,size.width,size.height);}},
        head: [["Description", "Qty", "Unit price", "Amount"]],
        body: [
          ...job.lines.map((l) => [
            l.name,
            String(l.quantity),
            amount(l.price),
            amount(l.total),
          ]),
          ["Subtotal", "", "", amount(job.subtotal)],
          [`Tax (${job.tax_percent}%)`, "", "", amount(job.tax)],
          ["Total", "", "", amount(job.total)],
        ],
        styles: { fontSize: 9, overflow: "linebreak" },
        columnStyles: { 0: { cellWidth: 90 } },
      });
      const transport = nodemailer.createTransport(smtp!);
      try {
        return await sendSmtp(
          `recurring-${job.id}`,
          {
            from: from!,
            to: [job.recipient],
            subject: `Invoice ${job.reference}`,
            text: `Please find your invoice attached. Reference: ${job.reference}. Due: ${job.due}.`,
            attachments: [
              {
                filename: `${job.reference}.pdf`,
                content: pdf.output("datauristring").split(",")[1],
              },
            ],
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
      } finally {
        transport.close();
      }
    },
  }),
);
