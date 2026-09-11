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
    const transport = nodemailer.createTransport(smtp);
    try {
      const result = await sendSmtp(
        `notification-${job.id}`,
        { from: sender!, to: [job.recipient], ...message },
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
