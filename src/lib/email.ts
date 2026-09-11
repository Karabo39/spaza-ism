import nodemailer from "nodemailer";
import type { createClient } from "@/lib/supabase/server";
import {
  smtpOptions,
  sendSmtp,
  type Mail,
} from "../../supabase/functions/_shared/smtp";

export function emailConfigured() {
  return !!smtpOptions((key) => process.env[key]);
}
export async function sendEmail(
  db: Awaited<ReturnType<typeof createClient>>,
  key: string,
  mail: Mail,
) {
  const options = smtpOptions((name) => process.env[name]);
  if (!options) throw new Error("SMTP_NOT_CONFIGURED");
  const transport = nodemailer.createTransport(options);
  try {
    return await sendSmtp(
      key,
      mail,
      {
        begin: async (p_key) => {
          const { data, error } = await db.rpc("smtp_delivery", { p_key });
          if (error) throw new Error("SMTP_RESERVATION_FAILED");
          return data as { token?: string; provider?: string };
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
}
