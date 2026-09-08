type Delivery = {
  id: string;
  email: string;
  business: string;
  existing: boolean;
  secret: string;
  version: number;
  expires_at: string;
};
type AuthLink = { userId: string; tokenHash: string; type: string };
type Dependencies = {
  configured: boolean;
  authenticate: (token: string) => Promise<string | null>;
  prepare: (actor: string, id: string, version: number) => Promise<Delivery>;
  link: (delivery: Delivery) => Promise<AuthLink>;
  send: (
    recipient: string,
    subject: string,
    text: string,
    key: string,
  ) => Promise<void>;
  finish: (delivery: Delivery, user: string, sent: boolean) => Promise<void>;
  appUrl: string;
};
export function invitationHandler(deps: Dependencies) {
  return async (request: Request): Promise<Response> => {
    const headers = {
      "Access-Control-Allow-Origin": deps.appUrl,
      "Access-Control-Allow-Headers":
        "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Cache-Control": "no-store",
    };
    const reply = (status: number, error?: string) =>
      Response.json(error ? { error } : { sent: true }, { status, headers });
    if (request.method === "OPTIONS") return new Response(null, { headers });
    if (request.method !== "POST") return reply(405, "Method not allowed.");
    const origin = request.headers.get("origin");
    if (origin && origin !== deps.appUrl)
      return reply(403, "Invalid request origin.");
    let delivery: Delivery | undefined;
    let link: AuthLink | undefined;
    let sent = false;
    try {
      const actor = await deps.authenticate(
        (request.headers.get("authorization") ?? "").replace(/^Bearer /i, ""),
      );
      if (!actor) return reply(401, "Sign in to send invitations.");
      if (!deps.configured)
        return reply(
          503,
          "Invitation email is not configured. Your invitation is saved but has not been sent. Contact your administrator.",
        );
      const text = await request.text();
      if (text.length > 2048) return reply(400, "Invalid invitation request.");
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        return reply(400, "Invalid invitation request.");
      }
      if (
        !body ||
        !/^[0-9a-f-]{36}$/i.test(body.invitationId ?? "") ||
        !Number.isSafeInteger(body.version) ||
        body.version < 1
      )
        return reply(400, "Invalid invitation request.");
      delivery = await deps.prepare(actor, body.invitationId, body.version);
      link = await deps.link(delivery);
      const fragment = new URLSearchParams({
        id: delivery.id,
        secret: delivery.secret,
        token_hash: link.tokenHash,
        type: link.type,
      });
      const url = `${deps.appUrl}/accept-invitation#${fragment}`;
      await deps.send(
        delivery.email,
        `Invitation to ${delivery.business} on POS INVENTORY`,
        `You have been invited to join ${delivery.business} on POS INVENTORY.\n\nAccept invitation: ${url}\n\nThis invitation expires at ${delivery.expires_at}. Open the link, confirm your email, then complete your name, surname, phone and password. Your employer manages your email and store access.\n\nIf you were not expecting this invitation, you can ignore it.`,
        `employee-invitation-${delivery.id}-${delivery.version}`,
      );
      sent = true;
      await deps.finish(delivery, link.userId, true);
      return reply(200);
    } catch (error) {
      if (delivery && link && !sent)
        await deps.finish(delivery, link.userId, false).catch(() => {});
      const code = error instanceof Error ? error.message : "";
      if (code === "FORBIDDEN")
        return reply(403, "Only an authorized owner can send this invitation.");
      if (code === "INVITATION_RATE_LIMITED")
        return reply(429, "Wait one minute before resending an invitation.");
      if (
        [
          "INVITATION_CHANGED",
          "INVITER_NO_LONGER_AUTHORIZED",
          "INVALID_LOCATION",
        ].includes(code)
      )
        return reply(
          409,
          "This invitation or its access changed. Refresh and review it before resending.",
        );
      return reply(
        502,
        "Could not confirm invitation delivery. Refresh the invitation status before trying again.",
      );
    }
  };
}
