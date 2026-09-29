import nodemailer from "npm:nodemailer@10.0.3";
import { createClient } from "npm:@supabase/supabase-js@2.112.4";
import { jsPDF } from "npm:jspdf@4.2.1";
import { autoTable } from "npm:jspdf-autotable@5.0.8";
import { smtpOptions, sendSmtp } from "../_shared/smtp.ts";
import { customerEmail, customerPdf } from "../_shared/customer-document.ts";
import { decodeDocumentLogo } from "../_shared/document-logo.ts";
import { customerNotificationHandler } from "./handler.ts";

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
  customerNotificationHandler({
    configured: !!(smtp && from && url && key),
    authenticate: (p_secret) =>
      db.rpc("authenticate_recurring_worker", { p_secret }),
    claim: () => db.rpc("claim_customer_documents", { p_limit: 5 }),
    complete: (job, p_outcome, provider) =>
      db.rpc("complete_customer_document", {
        p_id: job.id,
        p_token: job.token,
        p_outcome,
        p_provider: provider ?? null,
      }),
    prepare: async (job) => {
      let logo = null;
      if (job.document.logo_path) {
        const asset = await db.storage
          .from("document-logos")
          .download(job.document.logo_path);
        if (asset.error) throw asset.error;
        logo = decodeDocumentLogo(
          new Uint8Array(await asset.data.arrayBuffer()),
        );
      }
      return customerPdf(job.document, new jsPDF(), autoTable, logo);
    },
    send: async (job, attachment) => {
      const transport = nodemailer.createTransport(smtp!);
      try {
        return await sendSmtp(
          `customer-${job.id}`,
          {
            from: from!,
            to: [job.recipient],
            ...customerEmail(job.document),
            attachments: [
              {
                filename: `${job.document.reference.replace(/[^a-zA-Z0-9_-]/g, "_")}.pdf`,
                content: attachment,
              },
            ],
          },
          {
            begin: async (p_key) => {
              const result = await db.rpc("smtp_delivery", { p_key });
              if (result.error) throw new Error("SMTP_RESERVATION_FAILED");
              return result.data;
            },
            finish: async (p_key, p_token, p_provider) => {
              const result = await db.rpc("smtp_delivery", {
                p_key,
                p_token,
                p_provider,
              });
              if (result.error) throw new Error("SMTP_RECORD_FAILED");
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
