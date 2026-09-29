import type { CustomerDocument } from "../_shared/customer-document.ts";
export type CustomerJob = {
  id: string;
  token: string;
  recipient: string;
  document: CustomerDocument;
};
type Result<T> = { data: T | null; error: { message: string } | null };
export function customerNotificationHandler(deps: {
  configured: boolean;
  authenticate: (secret: string) => PromiseLike<Result<boolean>>;
  claim: () => PromiseLike<Result<CustomerJob[]>>;
  prepare: (job: CustomerJob) => Promise<string>;
  send: (job: CustomerJob, attachment: string) => Promise<{ id: string }>;
  complete: (
    job: CustomerJob,
    outcome: "SENT" | "UNCERTAIN" | "PREPARATION_FAILED",
    provider?: string,
  ) => PromiseLike<{ error: { message: string } | null }>;
}) {
  return async (request: Request) => {
    if (request.method !== "POST")
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    if (!deps.configured)
      return Response.json(
        { error: "Email configuration incomplete" },
        { status: 503 },
      );
    const secret = request.headers.get("x-recurring-secret") ?? "";
    if (!/^[0-9a-f]{64}$/.test(secret))
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    const auth = await deps.authenticate(secret);
    if (auth.error || auth.data !== true)
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    const claimed = await deps.claim();
    if (claimed.error)
      return Response.json(
        { error: "Could not claim documents" },
        { status: 500 },
      );
    let sent = 0,
      failed = 0;
    // A bounded batch is processed concurrently so slow SMTP cannot exhaust the invocation.
    await Promise.all(
      (claimed.data ?? []).map(async (job) => {
        let attachment: string;
        try {
          attachment = await deps.prepare(job);
        } catch {
          failed++;
          await deps.complete(job, "PREPARATION_FAILED");
          return;
        }
        try {
          const delivered = await deps.send(job, attachment);
          const done = await deps.complete(job, "SENT", delivered.id);
          if (done.error) failed++;
          else sent++;
        } catch {
          failed++;
          await deps.complete(job, "UNCERTAIN");
        }
      }),
    );
    return Response.json({ sent, failed }, { status: failed ? 502 : 200 });
  };
}
