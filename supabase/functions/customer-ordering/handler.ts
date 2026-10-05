type Result = { data: unknown; error: { message: string } | null };
export type OrderingBackend = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<Result>;
  images(paths: string[]): Promise<Record<string, string | null>>;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const secret = /^[a-f0-9]{64}$/;
const allowed = new Set(["https://posinventory.shop", "http://localhost:3000"]);
const safeErrors = new Set([
  "SHOP_UNAVAILABLE",
  "ORDER_NOT_FOUND",
  "PRODUCT_UNAVAILABLE",
  "INVALID_CONTACT",
  "INVALID_ITEMS",
  "INVALID_QUANTITY",
  "INVALID_PAYMENT",
  "INVALID_COLLECTION_DATE",
  "FULFILMENT_UNAVAILABLE",
  "REQUEST_CONFLICT",
  "SHOP_BUSY",
]);

/** Public customer mode: only a store link, and for status a private order token. */
export function orderingHandler(db: OrderingBackend) {
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get("origin");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      Vary: "Origin",
    };
    if (origin && allowed.has(origin))
      Object.assign(headers, {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Headers": "content-type, apikey, authorization",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      });
    const reply = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers });
    if (origin && !allowed.has(origin))
      return reply({ error: "FORBIDDEN" }, 403);
    if (req.method === "OPTIONS")
      return new Response(null, { status: 204, headers });
    if (req.method !== "POST")
      return reply({ error: "METHOD_NOT_ALLOWED" }, 405);
    try {
      // Limit streamed input too; Content-Length cannot be trusted.
      const reader = req.body?.getReader();
      if (!reader) return reply({ error: "INVALID_REQUEST" }, 400);
      let size = 0;
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 16000) {
          await reader.cancel();
          return reply({ error: "REQUEST_TOO_LARGE" }, 413);
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      const body = JSON.parse(new TextDecoder().decode(bytes));
      if (
        !body ||
        typeof body !== "object" ||
        typeof body.link !== "string" ||
        !uuid.test(body.link)
      )
        return reply({ error: "SHOP_UNAVAILABLE" }, 400);
      let result: Result;
      if (body.action === "catalog") {
        if (
          body.after &&
          (typeof body.after !== "string" || !uuid.test(body.after))
        )
          return reply({ error: "INVALID_REQUEST" }, 400);
        result = await db.rpc("customer_catalog", {
          p_link: body.link,
          p_search:
            typeof body.search === "string" ? body.search.slice(0, 100) : "",
          p_after: body.after || null,
        });
        if (!result.error && result.data) {
          const catalog = result.data as {
            products: Record<string, unknown>[];
          };
          const paths = catalog.products
            .map((p) => p.image_path)
            .filter((p): p is string => typeof p === "string");
          const images = paths.length ? await db.images(paths) : {};
          catalog.products = catalog.products.map((p) => {
            const { image_path, ...visible } = p;
            return {
              ...visible,
              image_url:
                typeof image_path === "string"
                  ? images[image_path] || null
                  : null,
            };
          });
        }
      } else if (body.action === "status") {
        if (
          typeof body.order !== "string" ||
          !uuid.test(body.order) ||
          typeof body.secret !== "string" ||
          !secret.test(body.secret)
        )
          return reply({ error: "ORDER_NOT_FOUND" }, 404);
        result = await db.rpc("customer_order_status", {
          p_link: body.link,
          p_order: body.order,
          p_secret: body.secret,
        });
      } else if (body.action === "place") {
        if (
          typeof body.request !== "string" ||
          !uuid.test(body.request) ||
          typeof body.secret !== "string" ||
          !secret.test(body.secret) ||
          body.website
        )
          return reply({ error: "INVALID_REQUEST" }, 400);
        if (
          !Array.isArray(body.items) ||
          body.items.length < 1 ||
          body.items.length > 50 ||
          !body.items.every(
            (i: Record<string, unknown>) =>
              i &&
              typeof i.product_id === "string" &&
              uuid.test(i.product_id) &&
              typeof i.quantity === "number" &&
              Number.isFinite(i.quantity) &&
              i.quantity > 0 &&
              i.quantity <= 10000,
          )
        )
          return reply({ error: "INVALID_ITEMS" }, 400);
        if (
          !body.contact ||
          typeof body.contact !== "object" ||
          !["COLLECTION", "DELIVERY"].includes(body.fulfilment) ||
          !["BANK_TRANSFER", "PAY_ON_COLLECTION"].includes(body.payment) ||
          typeof body.date !== "string" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(body.date)
        )
          return reply({ error: "INVALID_REQUEST" }, 400);
        const address =
          req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
          "unknown";
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(address + ":" + body.link),
        );
        const key = Array.from(new Uint8Array(digest), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join("");
        const limit = await db.rpc("online_rate_limit", { p_key: key });
        if (limit.error || limit.data !== true)
          return reply({ error: "TOO_MANY_ORDERS" }, 429);
        const contact = Object.fromEntries(
          ["name", "phone", "email", "address", "notes"].map((k) => [
            k,
            typeof body.contact[k] === "string" ? body.contact[k] : "",
          ]),
        );
        result = await db.rpc("place_customer_order", {
          p_link: body.link,
          p_request: body.request,
          p_secret: body.secret,
          p_contact: {
            ...contact,
            email_notifications: body.contact.email_notifications === true,
          },
          p_items: body.items.map((i: Record<string, unknown>) => ({
            product_id: i.product_id,
            quantity: i.quantity,
          })),
          p_fulfilment: body.fulfilment,
          p_date: body.date,
          p_payment: body.payment,
        });
      } else return reply({ error: "INVALID_REQUEST" }, 400);
      if (result.error)
        return reply(
          {
            error: safeErrors.has(result.error.message)
              ? result.error.message
              : "UNABLE_TO_COMPLETE",
          },
          400,
        );
      return reply({ data: result.data });
    } catch {
      return reply({ error: "INVALID_REQUEST" }, 400);
    }
  };
}
