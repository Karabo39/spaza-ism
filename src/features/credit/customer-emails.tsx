"use client";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { useOffline } from "@/lib/offline/offline-context";
import { dateTime } from "@/lib/format";

type History = {
  id: string;
  type: string;
  reference: string;
  state: string;
  created_at: string;
  sent_at: string | null;
  error: string | null;
};
export function CustomerEmails({
  customerId,
  enabled,
}: {
  customerId: string;
  enabled: boolean;
}) {
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Africa/Johannesburg",
  });
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`),
    [to, setTo] = useState(today);
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const request = useRef<{ key: string; id: string } | null>(null),
    lock = useRef(false);
  const { online } = useOffline();
  const history = useQuery({
    queryKey: ["customer-emails", customerId],
    enabled: open && online,
    staleTime: 0,
    queryFn: async () => {
      const result = await createClient().rpc("customer_email_history", {
        p_customer: customerId,
      });
      if (result.error) throw result.error;
      return result.data as unknown as History[];
    },
  });
  return (
    <section className="my-5 rounded-lg border border-border bg-surface p-4">
      <button
        type="button"
        className="w-full text-left font-semibold"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Customer email notifications {open ? "−" : "+"}
      </button>
      {open && (
        <div className="mt-4 space-y-4">
          <p className="text-sm text-muted">
            {enabled
              ? "Automatic document emails are enabled. Pending documents are normally processed within a minute."
              : "Enable Email Notifications in the customer profile to send future transaction documents and statements."}{" "}
            Sent means the email provider accepted the message; it does not
            confirm that the customer read it.
          </p>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (lock.current || !online || !enabled) return;
              lock.current = true;
              setBusy(true);
              setNotice("");
              const key = `${customerId}/${from}/${to}`;
              if (request.current?.key !== key)
                request.current = { key, id: crypto.randomUUID() };
              try {
                const result = await createClient().rpc(
                  "queue_customer_statement",
                  {
                    p_customer: customerId,
                    p_request: request.current.id,
                    p_from: from,
                    p_to: to,
                  },
                );
                if (result.error) throw result.error;
                setNotice(
                  "Statement generated and queued for email. All transactions in this date range are included.",
                );
                await history.refetch();
              } catch (error) {
                const message = (error as Error).message;
                setNotice(
                  message.includes("CUSTOMER_EMAIL_DISABLED")
                    ? "Email Notifications must be enabled with a valid customer email address."
                    : message.includes("STATEMENT_DATE_RANGE") ||
                        message.includes("STATEMENT_TOO_LARGE")
                      ? "Choose a shorter statement period (up to one year)."
                      : "Could not queue the statement. Check your access and connection, then retry.",
                );
              } finally {
                lock.current = false;
                setBusy(false);
              }
            }}
          >
            <label className="text-sm">
              Statement from
              <Input
                type="date"
                required
                value={from}
                max={to}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label className="text-sm">
              Statement to
              <Input
                type="date"
                required
                value={to}
                min={from}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
            <Button type="submit" loading={busy} disabled={!online || !enabled}>
              Generate &amp; email statement
            </Button>
          </form>
          {notice && (
            <p role="status" className="text-sm">
              {notice}
            </p>
          )}
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Recent document emails</h3>
            <Button
              variant="ghost"
              disabled={!online || history.isFetching}
              onClick={() => history.refetch()}
            >
              Refresh status
            </Button>
          </div>
          {history.isError ? (
            <p role="alert">Could not load email history.</p>
          ) : history.isLoading ? (
            <p>Loading email history…</p>
          ) : !history.data?.length ? (
            <p className="text-sm text-muted">No document emails yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {history.data.map((row) => (
                <li key={row.id} className="py-3 text-sm">
                  <div className="flex flex-wrap justify-between gap-2">
                    <span>
                      {row.type} · {row.reference}
                    </span>
                    <strong>
                      {row.state === "UNCERTAIN"
                        ? "Needs delivery review"
                        : row.state === "PROCESSING"
                          ? "Sending"
                          : row.state.charAt(0) +
                            row.state.slice(1).toLowerCase()}
                    </strong>
                  </div>
                  <p className="text-xs text-muted">
                    {dateTime(row.created_at)}
                    {row.sent_at ? ` · Sent ${dateTime(row.sent_at)}` : ""}
                  </p>
                  {row.error && <p className="mt-1 text-xs">{row.error}</p>}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted">
            Showing the 50 most recent emails you have permission to view.
            Unconfirmed deliveries are not resent automatically, to avoid
            duplicate emails.
          </p>
        </div>
      )}
    </section>
  );
}
