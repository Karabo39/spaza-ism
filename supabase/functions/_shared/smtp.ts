export type Mail = {
  from: string;
  to: string[];
  subject: string;
  text: string;
  attachments?: { filename: string; content: string; encoding?: string }[];
};
export type SmtpLedger = {
  begin: (key: string) => Promise<{ token?: string; provider?: string }>;
  finish: (key: string, token: string, provider: string) => Promise<void>;
};
export function smtpOptions(env: (key: string) => string | undefined) {
  const user = env("SMTP_USER")?.trim();
  const pass = env("SMTP_PASSWORD");
  if (!user || !pass) return null;
  return {
    host: "smtp.hostinger.com",
    port: 465,
    secure: true,
    auth: { user, pass },
    tls: { minVersion: "TLSv1.2" as const, rejectUnauthorized: true },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    disableFileAccess: true,
    disableUrlAccess: true,
    logger: false,
    debug: false,
  };
}
// A reservation is deliberately never automatically released after a failure:
// SMTP may have accepted DATA even if its final acknowledgement was lost.
export async function sendSmtp(
  key: string,
  mail: Mail,
  ledger: SmtpLedger,
  deliver: (
    mail: Mail & { messageId: string },
  ) => Promise<{ accepted: unknown[]; messageId: string }>,
) {
  const reservation = await ledger.begin(key);
  if (reservation.provider) return { id: reservation.provider };
  if (!reservation.token) throw new Error("SMTP_DELIVERY_UNCERTAIN");
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(key),
  );
  const hash = Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  try {
    const result = await deliver({
      ...mail,
      attachments: mail.attachments?.map((a) => ({ ...a, encoding: "base64" })),
      messageId: `<${hash}@posinventory.store>`,
    });
    if (result.accepted.length !== mail.to.length)
      throw new Error("SMTP_RECIPIENT_REJECTED");
    await ledger.finish(key, reservation.token, result.messageId);
    return { id: result.messageId };
  } catch {
    // Never leak SMTP credentials or provider responses into logs or the UI.
    throw new Error("SMTP_DELIVERY_UNCERTAIN");
  }
}
