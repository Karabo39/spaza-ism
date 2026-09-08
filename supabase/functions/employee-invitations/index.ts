import { createClient } from "npm:@supabase/supabase-js@2.112.4";
import { invitationHandler } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const emailKey = Deno.env.get("RESEND_API_KEY");
const sender = Deno.env.get("REPORT_EMAIL_FROM");
const appUrl =
  Deno.env.get("INVITATION_APP_URL") ?? "https://posinventory.shop";
const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
Deno.serve(
  invitationHandler({
    configured: !!(url && key && emailKey && sender),
    appUrl,
    authenticate: async (token) => {
      if (!token) return null;
      const { data, error } = await admin.auth.getUser(token);
      return error ? null : (data.user?.id ?? null);
    },
    prepare: async (actor, id, version) => {
      const { data, error } = await admin.rpc(
        "prepare_employee_invitation_delivery",
        { p_actor: actor, p_invitation: id, p_expected: version },
      );
      if (error) throw new Error(error.message);
      return data;
    },
    link: async (delivery) => {
      const { data, error } = await admin.auth.admin.generateLink({
        type: delivery.existing ? "magiclink" : "invite",
        email: delivery.email,
      });
      if (error || !data.user || !data.properties)
        throw new Error("AUTH_LINK_FAILED");
      return {
        userId: data.user.id,
        tokenHash: data.properties.hashed_token,
        type: data.properties.verification_type,
      };
    },
    send: async (recipient, subject, text, idempotencyKey) => {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(15000),
        headers: {
          Authorization: `Bearer ${emailKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({ from: sender, to: [recipient], subject, text }),
      });
      if (!response.ok) throw new Error("EMAIL_DELIVERY_FAILED");
    },
    finish: async (delivery, user, sent) => {
      const { error } = await admin.rpc("finish_employee_invitation_delivery", {
        p_invitation: delivery.id,
        p_version: delivery.version,
        p_user: user,
        p_sent: sent,
      });
      if (error) throw new Error("DELIVERY_STATUS_FAILED");
    },
  }),
);
