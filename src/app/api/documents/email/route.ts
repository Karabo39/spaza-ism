import { createHash } from "node:crypto";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { loadEmailDocument } from "@/features/billing/document-email";
import { reportFile } from "@/features/reports/export-data";
export const runtime = "nodejs";
const documentSchema = z.object({
  type: z.enum(["invoice", "return"]),
  id: z.string().uuid(),
});
const sendSchema = documentSchema.extend({
  recipient: z.string().trim().email().max(254),
  requestId: z.string().uuid(),
});
async function authorized(type: "invoice" | "return", id: string) {
  const session = await getSession();
  const store = session?.activeStore;
  if (!store)
    return {
      response: Response.json(
        { error: "Sign in to email a document." },
        { status: 401 },
      ),
    };
  if (!store.modules[type === "invoice" ? "invoices_view_invoices" : "returns"])
    return {
      response: Response.json(
        { error: "You do not have access to this document module." },
        { status: 403 },
      ),
    };
  const db = await createClient();
  const document = await loadEmailDocument(
    db,
    type,
    id,
    store.id,
    store.name,
    store.businessName,
    store.currency,
  );
  if (!document)
    return {
      response: Response.json(
        { error: "Document not found at the active store." },
        { status: 404 },
      ),
    };
  return { db, document };
}
export async function GET(request: Request) {
  const parsed = documentSchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success)
    return Response.json({ error: "Invalid document." }, { status: 400 });
  try {
    const result = await authorized(parsed.data.type, parsed.data.id);
    if (result.response) return result.response;
    return Response.json(
      {
        recipient: result.document.recipient,
        reference: result.document.reference,
        configured:
          !!process.env.RESEND_API_KEY && !!process.env.REPORT_EMAIL_FROM,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Could not load the document. Try again." },
      { status: 503 },
    );
  }
}
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const raw = await request.text();
  if (raw.length > 4000)
    return Response.json({ error: "Invalid request size." }, { status: 413 });
  let body;
  try {
    body = sendSchema.parse(JSON.parse(raw));
  } catch {
    return Response.json(
      { error: "Check the document and recipient email." },
      { status: 400 },
    );
  }
  try {
    const result = await authorized(body.type, body.id);
    if (result.response) return result.response;
    if (!process.env.RESEND_API_KEY || !process.env.REPORT_EMAIL_FROM)
      return Response.json(
        {
          error:
            "Document email is not configured. Ask your administrator to configure the verified sender.",
        },
        { status: 503 },
      );
    const { db, document } = result;
    const hash = createHash("sha256")
      .update(
        JSON.stringify({
          type: body.type,
          id: body.id,
          recipient: body.recipient,
          data: document.data,
        }),
      )
      .digest("hex");
    const prepared = await db.rpc("prepare_document_email", {
      p_type: body.type,
      p_document: body.id,
      p_request: body.requestId,
      p_hash: hash,
      p_recipient: body.recipient,
    });
    if (prepared.error)
      return Response.json(
        {
          error: prepared.error.message.includes("RATE_LIMITED")
            ? "Daily email limit reached. Try again tomorrow."
            : "Could not prepare this delivery. If the document changed, close and reopen the email form.",
        },
        { status: 409 },
      );
    const job = prepared.data as {
      id: string;
      sent: boolean;
      created_at: string;
    };
    if (job.sent) return Response.json({ sent: true });
    const file = await reportFile(
      { ...document.data, createdAt: job.created_at, fileId: job.id },
      "pdf",
    );
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `document-${job.id}`,
      },
      body: JSON.stringify({
        from: process.env.REPORT_EMAIL_FROM,
        to: [body.recipient],
        subject: document.data.title,
        text: `Please find your ${body.type === "invoice" ? "invoice" : "return receipt"} attached. Reference: ${document.reference}`,
        attachments: [
          {
            filename: `${document.reference.replace(/[^a-zA-Z0-9_-]/g, "_")}.pdf`,
            content: Buffer.from(await file.arrayBuffer()).toString("base64"),
          },
        ],
      }),
    });
    if (!response.ok)
      return Response.json(
        {
          error:
            "Email delivery was not confirmed. Retry with the same details.",
        },
        { status: 502 },
      );
    const provider = (await response.json()) as { id: string };
    const completed = await db.rpc("complete_report_email", {
      p_job: job.id,
      p_provider: provider.id,
    });
    if (completed.error)
      return Response.json(
        {
          error:
            "Email accepted but its status could not be saved. Retry with the same details.",
        },
        { status: 502 },
      );
    return Response.json({ sent: true });
  } catch {
    return Response.json(
      { error: "Could not confirm delivery. Retry with the same details." },
      { status: 502 },
    );
  }
}
