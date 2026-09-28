export type RecurringDelivery = {
  id: string;
  token: string;
  recipient: string;
  reference: string;
  business: string;
  store: string;
  customer: { name: string; email?: string; address?: string };
  date: string;
  due: string;
  currency: string;
  subtotal: number;
  tax_percent: number;
  tax: number;
  total: number;
  lines: { name: string; quantity: number; price: number; total: number }[];
};
type Result<T> = { data: T | null; error: { message: string } | null };
export function recurringHandler(deps: {
  authenticate: (
    secret: string,
  ) => PromiseLike<{ data: boolean | null; error: { message: string } | null }>;
  configured: boolean;
  claim: () => PromiseLike<Result<RecurringDelivery[]>>;
  send: (job: RecurringDelivery) => Promise<{ id: string }>;
  complete: (
    job: RecurringDelivery,
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
    const authentication = await deps.authenticate(secret);
    if (authentication.error || authentication.data !== true)
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    const claimed = await deps.claim();
    if (claimed.error)
      return Response.json(
        { error: "Could not claim invoices" },
        { status: 500 },
      );
    let sent = 0,
      uncertain = 0;
    for (const job of claimed.data ?? []) {
      try {
        const result = await deps.send(job);
        const done = await deps.complete(job, result.id);
        if (done.error) uncertain++;
        else sent++;
      } catch {
        uncertain++;
        await deps.complete(job);
      }
    }
    return Response.json(
      { sent, uncertain },
      { status: uncertain ? 502 : 200 },
    );
  };
}
