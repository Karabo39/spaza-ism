import { emailConfigured, sendEmail } from "@/lib/email";
import { BRAND_NAME } from "@/lib/brand";
import { createHash } from "node:crypto";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { reportFile } from "@/features/reports/export-data";
export const runtime = "nodejs";
const schema = z.object({
  module: z.enum(["reports", "check_stock", "invoices"]).default("reports"),
  storeId: z.string().uuid(),
  requestId: z.string().uuid(),
  recipient: z.string().email().max(254),
  format: z.enum(["xlsx", "pdf", "csv"]),
  filename: z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/),
  title: z.string().min(1).max(150),
  subtitle: z.string().max(250).optional(),
  columns: z
    .array(
      z.object({
        key: z.string().min(1).max(100),
        label: z.string().min(1).max(150),
      }),
    )
    .min(1)
    .max(30),
  rows: z
    .array(
      z.record(
        z.union([
          z.string().max(10000),
          z.number().finite(),
          z.boolean(),
          z.null(),
        ]),
      ),
    )
    .min(1)
    .max(5000),
});
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const session = await getSession();
  if (!session?.activeStore)
    return Response.json(
      { error: "Sign in to email a report." },
      { status: 401 },
    );

  if (!emailConfigured() || !process.env.REPORT_EMAIL_FROM)
    return Response.json(
      {
        error:
          "Report email is not configured yet. Your administrator must configure the sender and delivery key.",
      },
      { status: 503 },
    );
  const raw = await request.text();
  if (raw.length > 2_000_000)
    return Response.json(
      {
        error:
          "This report is too large to email. Narrow the filters or download it.",
      },
      { status: 413 },
    );
  let parsed;
  try {
    parsed = schema.safeParse(JSON.parse(raw));
  } catch {
    return Response.json({ error: "Invalid report." }, { status: 400 });
  }
  if (!parsed.success)
    return Response.json(
      { error: "Check the recipient and report size." },
      { status: 400 },
    );
  const body = parsed.data;
  if (!session.activeStore.modules[body.module])
    return Response.json(
      { error: "You do not have access to this module at this store." },
      { status: 403 },
    );
  if (body.storeId !== session.activeStore.id)
    return Response.json(
      { error: "Switch to this report's location before sending." },
      { status: 403 },
    );
  const db = await createClient();
  const { data, error } = await db.rpc("prepare_report_email", {
    p_store: body.storeId,
    p_request: body.requestId,
    p_hash: createHash("sha256").update(JSON.stringify(body)).digest("hex"),
    p_recipient: body.recipient,
  });
  if (error)
    return Response.json(
      {
        error: error.message.includes("RATE_LIMITED")
          ? "You have reached the daily limit of 20 report emails."
          : error.message.includes("RETRY_EXPIRED")
            ? "This old delivery attempt cannot be retried. Check whether it arrived before preparing a new email."
            : "Could not authorize this report email. Refresh and try again.",
      },
      { status: 409 },
    );
  const job = data as { id: string; sent: boolean; created_at: string };
  if (job.sent) return Response.json({ sent: true });
  try {
    const attachment = await reportFile(
      { ...body, createdAt: job.created_at, fileId: job.id },
      body.format,
    );
    const result = await sendEmail(db, `report-${job.id}`, {
      from: process.env.REPORT_EMAIL_FROM,
      to: [body.recipient],
      subject: `${BRAND_NAME} report: ${body.title}`,
      text: `${body.title}\n${body.subtitle ?? ""}\n${body.rows.length} exported rows.`,
      attachments: [
        {
          filename: `${body.filename}.${body.format}`,
          content: Buffer.from(await attachment.arrayBuffer()).toString(
            "base64",
          ),
        },
      ],
    });
    const completed = await db.rpc("complete_report_email", {
      p_job: job.id,
      p_provider: result.id,
    });
    if (completed.error)
      return Response.json(
        {
          error:
            "Delivery was accepted but could not be recorded. Retry with the same details to reconcile it.",
        },
        { status: 502 },
      );
    return Response.json({ sent: true });
  } catch {
    return Response.json(
      {
        error:
          "Delivery is unconfirmed. Check the recipient inbox or ask your administrator before starting a new delivery.",
      },
      { status: 502 },
    );
  }
}
