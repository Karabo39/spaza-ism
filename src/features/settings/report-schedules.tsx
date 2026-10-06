"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "@/lib/store-context";
import { createClient } from "@/lib/supabase/client";
import { useBillingAction } from "@/features/billing/use-billing-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { dateTime } from "@/lib/format";
import type { Json } from "@/lib/db/database.types";

const kinds = [
  ["DAILY_SALES", "Daily Sales Summary", "reports"],
  ["LOW_STOCK", "Low Stock Alert", "check_stock"],
  ["OUT_OF_STOCK", "Out of Stock Report", "check_stock"],
  ["OUTSTANDING_PAYMENTS", "Outstanding Payments", "invoices_view_invoices"],
  ["OVERDUE_INVOICES", "Overdue Invoices", "invoices_view_invoices"],
  ["STOCK_MOVEMENTS", "Stock Movement Summary", "reports"],
  ["MOVING_PRODUCTS", "Top & Slow-Moving Products", "reports"],
  ["CASH_UP", "Cash-Up / Financial Summary", "cash_up_manage"],
  ["ONLINE_ORDERS", "Online Orders Summary", "reports_online"],
  ["BUSINESS_PERFORMANCE", "Business Performance Report", "reports_financial"],
  ["UPCOMING_EXPIRY", "Upcoming Expiry", "expiry"],
  ["STOCK_TAKE_COMPLETED", "Completed Stock Counts", "stock_take"],
] as const;
type Schedule = {
  id: string;
  name: string;
  kind: string;
  frequency: string;
  send_time: string;
  weekday: number;
  monthday: number;
  recipients: string[];
  active: boolean;
  last_sent_at: string | null;
  next_send_at: string;
  version: number;
  last_error: string | null;
};
export function ReportSchedules() {
  const { store, canModule, user } = useStore();
  const { busy, online, run } = useBillingAction();
  const [editing, setEditing] = useState<Schedule | null | undefined>(
    undefined,
  );
  const query = useQuery({
    queryKey: ["billing", "report-schedules", store.id],
    enabled: canModule("settings_manage"),
    refetchInterval: 60000,
    queryFn: async () => {
      const r = await createClient().rpc("report_schedules_page", {
        p_store: store.id,
      });
      if (r.error) throw r.error;
      return r.data as unknown as Schedule[];
    },
  });
  if (!canModule("settings_manage")) return null;
  const available = kinds.filter((k) => canModule(k[2]));
  async function save(settings: Json, s?: Schedule | null) {
    await run(
      () =>
        createClient().rpc("save_report_schedule", {
          p_store: store.id,
          p_settings: settings,
          ...(s ? { p_id: s.id, p_expected: s.version } : {}),
        }),
      "Scheduled task saved",
      () => {
        setEditing(undefined);
        void query.refetch();
      },
    );
  }
  return (
    <section className="mt-6 space-y-4 rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-wrap justify-between gap-3">
        <h2 className="font-semibold">Scheduled Email Notifications</h2>
        <Button
          disabled={!online || !available.length}
          onClick={() => setEditing(null)}
        >
          Add scheduled notification
        </Button>
      </div>
      <p className="text-sm text-muted">
        Choose reports, recipients and exact sending time in South African time.
        Daily reports cover yesterday, weekly reports the previous seven days,
        and monthly reports the previous month. Delivery is checked every
        minute.
      </p>
      <h3 className="font-semibold">Scheduled Tasks</h3>
      {query.isLoading && <p role="status">Loading scheduled tasks…</p>}
      {query.error && (
        <p role="alert">
          Could not load scheduled tasks.{" "}
          <Button onClick={() => query.refetch()}>Retry</Button>
        </p>
      )}
      {!query.isLoading && !query.error && !query.data?.length && (
        <p>No scheduled notifications yet.</p>
      )}
      <div className="space-y-3">
        {query.data?.map((s) => (
          <article key={s.id} className="rounded-lg border border-border p-4">
            <div className="flex flex-wrap justify-between gap-3">
              <div>
                <h4 className="font-semibold">{s.name}</h4>
                <p className="text-sm">
                  {s.frequency.toLowerCase()} · {s.send_time.slice(0, 5)} ·{" "}
                  {s.active ? "Active" : "Inactive"}
                </p>
                <p className="break-all text-sm text-muted">
                  {s.recipients.join(", ")}
                </p>
                <p className="text-sm">
                  Last Sent:{" "}
                  {s.last_sent_at ? dateTime(s.last_sent_at) : "Not sent yet"}
                </p>
                <p className="text-sm">
                  Next Send: {s.active ? dateTime(s.next_send_at) : "Inactive"}
                </p>
                {s.last_error && (
                  <p role="alert" className="text-sm text-danger">
                    Last delivery failed: {s.last_error}. Edit and save to
                    retry.
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-start gap-2">
                <Button
                  disabled={!online || busy}
                  onClick={() => setEditing(s)}
                >
                  Edit
                </Button>
                <Button
                  variant="secondary"
                  disabled={!online || busy}
                  onClick={() => save({ ...s, active: !s.active }, s)}
                >
                  {s.active ? "Deactivate" : "Activate"}
                </Button>
              </div>
            </div>
          </article>
        ))}
      </div>
      <Dialog
        open={editing !== undefined}
        onOpenChange={(v) => {
          if (!v && !busy) setEditing(undefined);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogTitle>
            {editing
              ? "Edit scheduled notification"
              : "Schedule email notification"}
          </DialogTitle>
          <DialogDescription>
            Recipients receive this store’s report only. Reports require your
            current module permissions at sending time.
          </DialogDescription>
          {editing !== undefined && (
            <form
              key={editing?.id ?? "new"}
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void save(
                  {
                    name: String(f.get("name")),
                    kind: String(f.get("kind")),
                    frequency: String(f.get("frequency")),
                    send_time: String(f.get("time")),
                    weekday: Number(f.get("weekday")),
                    monthday: Number(f.get("monthday")),
                    recipients: String(f.get("recipients"))
                      .split(/[;,\n]+/)
                      .map((x) => x.trim())
                      .filter(Boolean),
                    active: f.get("active") === "on",
                  },
                  editing,
                );
              }}
            >
              <label className="block">
                Notification name
                <Input
                  name="name"
                  required
                  maxLength={120}
                  defaultValue={editing?.name ?? ""}
                />
              </label>
              <label className="block">
                Report
                <select
                  name="kind"
                  className="mt-1 w-full rounded border border-border bg-input p-2"
                  defaultValue={editing?.kind ?? available[0]?.[0]}
                >
                  {available.map((k) => (
                    <option key={k[0]} value={k[0]}>
                      {k[1]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                Frequency
                <select
                  name="frequency"
                  className="mt-1 w-full rounded border border-border bg-input p-2"
                  defaultValue={editing?.frequency ?? "DAILY"}
                >
                  <option value="DAILY">Daily</option>
                  <option value="WEEKLY">Weekly</option>
                  <option value="MONTHLY">Monthly</option>
                </select>
              </label>
              <label className="block">
                Sending time (South Africa)
                <Input
                  name="time"
                  type="time"
                  required
                  step={60}
                  defaultValue={editing?.send_time.slice(0, 5) ?? "08:00"}
                />
              </label>
              <label className="block">
                Weekly send day
                <select
                  name="weekday"
                  className="mt-1 w-full rounded border border-border bg-input p-2"
                  defaultValue={editing?.weekday ?? 1}
                >
                  {[
                    "Sunday",
                    "Monday",
                    "Tuesday",
                    "Wednesday",
                    "Thursday",
                    "Friday",
                    "Saturday",
                  ].map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                Monthly send day (1–28)
                <Input
                  name="monthday"
                  type="number"
                  min={1}
                  max={28}
                  required
                  defaultValue={editing?.monthday ?? 1}
                />
              </label>
              <label className="block">
                Email recipients
                <textarea
                  name="recipients"
                  required
                  className="mt-1 w-full rounded border border-border bg-input p-2"
                  defaultValue={
                    editing?.recipients.join("\n") ?? user.email ?? ""
                  }
                />
                <span className="text-xs text-muted">
                  One per line, or separate with commas. Maximum 20.
                </span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="active"
                  defaultChecked={editing?.active ?? true}
                />
                Active
              </label>
              <Button type="submit" disabled={!online || busy}>
                Save scheduled task
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
