import type { Instrumentation } from "next";
import { safeErrorEvent } from "@/lib/operational-errors";

const recentlySent = new Map<string, number>();
export const onRequestError: Instrumentation.onRequestError = async (error, _request, context) => {
  const event = safeErrorEvent(error, context.routePath);
  console.error(JSON.stringify(event));
  const target = process.env.OPERATIONS_ALERT_WEBHOOK;
  if (!target) return;
  const fingerprint = `${event.route}:${event.reference}:${event.code}`;
  if (Date.now() - (recentlySent.get(fingerprint) ?? 0) < 60000) return;
  try {
    if (new URL(target).protocol !== "https:") return;
    if (recentlySent.size > 1000) recentlySent.clear();
    recentlySent.set(fingerprint, Date.now());
    const response = await fetch(target, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event), signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) console.error(JSON.stringify({ event: "alert_delivery_failed", status: response.status }));
  } catch { console.error(JSON.stringify({ event: "alert_delivery_failed" })); }
};
