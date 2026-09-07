"use client";
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshCw, Wallet, CheckCircle2 } from "lucide-react";
import { useStore } from "@/lib/store-context";
import { useOffline } from "@/lib/offline/offline-context";
import { listQueuedSales } from "@/lib/offline/db";
import { createClient } from "@/lib/supabase/client";
import { businessDate } from "@/lib/business-date";
import { money, dateTime } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  amountCents,
  denominationCents,
  DENOMINATIONS,
  cashError,
} from "./cash-utils";
import type { CashSummary } from "./types";

export function CashUpConsole() {
  const { store, can, currency } = useStore();
  const { online, pending, failed, syncing, syncNow } = useOffline();
  const [day, setDay] = React.useState(businessDate());
  const [opening, setOpening] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const qc = useQueryClient();
  const queryKey = ["cash-up", store.id, day];
  const cash = useQuery({
    queryKey,
    enabled: online && !!day && store.locationType === "store",
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await createClient().rpc("cash_up_summary", {
        p_store: store.id,
        p_day: day,
      });
      if (error) throw error;
      return data as unknown as CashSummary;
    },
  });
  const recent = useQuery({
    queryKey: ["cash-up-days", store.id],
    enabled: online,
    queryFn: async () => {
      const { data } = await createClient()
        .from("cash_ups")
        .select("business_date, status")
        .eq("store_id", store.id)
        .order("business_date", { ascending: false })
        .limit(14)
        .throwOnError();
      return data ?? [];
    },
  });
  async function run(
    action: () => PromiseLike<{ error: { message: string } | null }>,
    message: string,
    checkQueue = false,
  ) {
    if (busy || !online) return;
    setBusy(true);
    setError("");
    try {
      if (
        checkQueue &&
        (await listQueuedSales(store.id)).some(
          (s) => s.status === "pending" || s.status === "failed",
        )
      ) {
        setError(
          "Sync or resolve this device’s queued sales before closing cash.",
        );
        return;
      }
      const { error } = await action();
      if (error) throw error;
      toast.success(message);
      await qc.invalidateQueries({ queryKey: ["cash-up", store.id, day] });
      await qc.invalidateQueries({ queryKey: ["cash-up-days", store.id] });
    } catch (e) {
      setError(cashError((e as Error).message));
    } finally {
      setBusy(false);
    }
  }
  const disabled = busy || !online || syncing;
  if (store.locationType === "warehouse")
    return (
      <p className="rounded-lg border border-border bg-surface p-6">
        Cash-up is for selling stores. Switch to a store to reconcile its cash
        drawer.
      </p>
    );
  const data = cash.data;
  const session = data?.session;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Label htmlFor="cash-day">Business date · {store.name}</Label>
          <Input
            id="cash-day"
            type="date"
            className="mt-2 w-52"
            value={day}
            max={businessDate()}
            disabled={busy}
            onChange={(e) => {
              if (e.target.value) {
                setDay(e.target.value);
                setError("");
              }
            }}
          />
        </div>
        <Button
          variant="outline"
          disabled={disabled || cash.isFetching}
          onClick={() => cash.refetch()}
        >
          <RefreshCw className="size-4" />
          Refresh totals
        </Button>
      </div>
      {recent.data && recent.data.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span>Recent cash-ups:</span>
          {recent.data.map((s) => (
            <button
              className="focus-ring rounded-md border border-border px-2 py-1 hover:bg-surface-2"
              key={s.business_date}
              onClick={() => {
                setDay(s.business_date);
                setError("");
              }}
              disabled={busy}
            >
              {s.business_date} · {s.status.toLowerCase()}
            </button>
          ))}
        </div>
      )}
      {!online && (
        <p
          role="status"
          className="rounded-lg border border-warning/30 bg-warning/5 p-4 text-sm text-warning"
        >
          Connect to load totals, submit a count or approve cash-up.
        </p>
      )}
      {pending + failed > 0 && (
        <div
          role="status"
          className="rounded-lg border border-warning/30 p-4 text-sm"
        >
          This device has {pending} pending and {failed} failed sales. Resolve
          them before closing.{" "}
          <Button
            variant="ghost"
            onClick={syncNow}
            loading={syncing}
            disabled={!online}
          >
            Sync now
          </Button>
        </div>
      )}
      <p className="text-xs text-muted">
        Sync every till before counting. Totals include payments received by the
        system on this date; offline sales enter cash-up on the day they sync.
      </p>
      {(error || cash.error) && (
        <p
          role="alert"
          className="rounded-lg border border-danger/30 bg-danger/5 p-4 text-sm text-danger"
        >
          {error || "Could not load cash-up. Reconnect and refresh."}
        </p>
      )}
      {cash.isLoading ? (
        <p role="status">Loading cash activity…</p>
      ) : (
        data && (
          <>
            {data.changed_since_count && session?.status !== "OPEN" && (
              <p
                className="rounded-lg border border-warning/30 bg-warning/5 p-4 text-sm text-warning"
                role="alert"
              >
                New cash activity arrived after this count. A manager must
                reopen and recount it. The earlier approval and count remain in
                history.
              </p>
            )}
            <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
              <section className="rounded-xl border border-border bg-surface p-5 sm:p-6">
                <div className="flex items-center gap-2">
                  <Wallet className="size-5 text-primary-hover" />
                  <h2 className="font-semibold">Cash expected</h2>
                </div>
                <dl className="mt-5 divide-y divide-border text-sm">
                  {[
                    ["Opening float", session?.opening_float ?? 0],
                    ["Cash checkout sales", data.sources.sales],
                    ["Cash invoice payments", data.sources.invoices],
                    ["Cash credit payments", data.sources.credit],
                    ["Other cash added", data.sources.added],
                    ["Cash refunds", -data.sources.refunds],
                    ["Cash removed / banked", -data.sources.removed],
                  ].map(([label, amount]) => (
                    <div
                      className="flex items-center justify-between gap-3 py-3"
                      key={String(label)}
                    >
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="font-medium tabular-nums">
                        {money(Number(amount), currency)}
                      </dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-3 rounded-lg bg-primary/10 p-4">
                  <p className="text-xs text-muted">
                    {session
                      ? "Expected in drawer"
                      : "Net cash before opening float"}
                  </p>
                  <p className="mt-1 text-3xl font-semibold tabular-nums">
                    {money(data.expected, currency)}
                  </p>
                </div>
                <p className="mt-3 text-xs text-muted">
                  Card/EFT payments and unpaid credit sales are excluded.
                  Invoice payments are counted once.
                </p>
              </section>
              {!session ? (
                <section className="rounded-xl border border-border bg-surface p-5 sm:p-6">
                  <h2 className="text-lg font-semibold">
                    Start this day’s cash-up
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Enter the cash that was in the drawer before trading began
                    on {day}.
                  </p>
                  <form
                    className="mt-5 space-y-4"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const cents = amountCents(opening);
                      if (cents === null) {
                        setError("Enter a valid opening float.");
                        return;
                      }
                      void run(
                        () =>
                          createClient().rpc("open_cash_up", {
                            p_store: store.id,
                            p_day: day,
                            p_float: cents / 100,
                          }),
                        "Cash-up opened",
                      );
                    }}
                  >
                    <div>
                      <Label htmlFor="opening-float">
                        Opening float ({currency})
                      </Label>
                      <Input
                        id="opening-float"
                        inputMode="decimal"
                        required
                        value={opening}
                        onChange={(e) => setOpening(e.target.value)}
                        placeholder="0.00"
                      />
                    </div>
                    <Button
                      type="submit"
                      loading={busy}
                      disabled={disabled || amountCents(opening) === null}
                    >
                      Start cash-up
                    </Button>
                  </form>
                </section>
              ) : session.status === "OPEN" ? (
                <CashCount
                  key={`${session.id}:${session.version}`}
                  data={data}
                  disabled={
                    disabled ||
                    pending + failed > 0 ||
                    data.sources.unclassified.length > 0
                  }
                  busy={busy}
                  onSubmit={(counted, denominations, note, request) =>
                    run(
                      () =>
                        createClient().rpc("submit_cash_up", {
                          p_cash_up: session.id,
                          p_counted: counted,
                          p_denominations: denominations,
                          p_fingerprint: data.count_token,
                          p_note: note,
                          p_request: request,
                        }),
                      "Count submitted for manager approval",
                      true,
                    )
                  }
                />
              ) : (
                <ReviewCount
                  key={`${session.id}:${session.version}`}
                  data={data}
                  disabled={disabled}
                  busy={busy}
                  onReview={(action, note) =>
                    run(
                      () =>
                        createClient().rpc("review_cash_up", {
                          p_cash_up: session.id,
                          p_submission: session.latest_submission!,
                          p_action: action,
                          p_note: note,
                        }),
                      action === "APPROVE"
                        ? "Cash-up approved"
                        : "Cash-up reopened",
                      action === "APPROVE",
                    )
                  }
                />
              )}
            </div>
            {data.sources.unclassified.length > 0 && (
              <section className="rounded-xl border border-warning/30 bg-surface p-5">
                <h2 className="font-semibold">Payment methods need checking</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  These older credit payments have no recorded method. A manager
                  must check the receipt or bank evidence and classify each
                  payment before this cash-up can be submitted.
                </p>
                <ul className="mt-4 divide-y divide-border">
                  {data.sources.unclassified.map((p) => (
                    <li
                      className="flex flex-wrap items-center justify-between gap-3 py-3"
                      key={p.id}
                    >
                      <div>
                        <p className="text-sm font-medium">
                          {p.customer_name} · {money(p.amount, currency)}
                        </p>
                        <p className="text-xs text-muted">
                          {dateTime(p.created_at)} · Ref {p.id.slice(0, 8)}
                        </p>
                      </div>
                      {can("manager") && (
                        <div className="flex gap-2">
                          {["CASH", "CARD_EFT"].map((method) => (
                            <Button
                              key={method}
                              size="sm"
                              variant="outline"
                              disabled={disabled}
                              onClick={() =>
                                run(
                                  () =>
                                    createClient().rpc(
                                      "classify_credit_payment",
                                      { p_transaction: p.id, p_method: method },
                                    ),
                                  "Payment method recorded",
                                )
                              }
                            >
                              {method === "CASH"
                                ? "Received as cash"
                                : "Received as card/EFT"}
                            </Button>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {can("manager") && (
              <CashManagement
                key={`${session?.id}:${session?.version}:${day}`}
                data={data}
                day={day}
                disabled={disabled}
                run={run}
              />
            )}
            {data.movements.length > 0 && (
              <section className="rounded-xl border border-border bg-surface p-5">
                <h2 className="font-semibold">Other drawer movements</h2>
                <ul className="mt-3 divide-y divide-border">
                  {data.movements.map((m) => (
                    <li
                      className="flex justify-between gap-3 py-3 text-sm"
                      key={m.id}
                    >
                      <div>
                        <p>{m.reason}</p>
                        <p className="mt-1 text-xs text-muted">
                          {dateTime(m.created_at)}
                        </p>
                      </div>
                      <span className="whitespace-nowrap tabular-nums">
                        {m.kind === "ADD" ? "+" : "−"}
                        {money(m.amount, currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {data.history.length > 0 && (
              <section className="rounded-xl border border-border bg-surface p-5 sm:p-6">
                <h2 className="text-lg font-semibold">
                  Count and approval history
                </h2>
                <p className="mt-1 text-sm text-muted">
                  Earlier counts remain recorded when a manager reopens a day.
                </p>
                <div className="mt-5 space-y-4">
                  {data.history.map((h, index) => (
                    <article
                      key={h.id}
                      className="rounded-lg border border-border p-4"
                    >
                      <div className="flex flex-wrap justify-between gap-2">
                        <h3 className="text-sm font-semibold">
                          {index === 0 ? "Latest count" : "Earlier count"} ·{" "}
                          {h.created_by_name}
                        </h3>
                        <p className="text-xs text-muted">
                          {dateTime(h.created_at)}
                        </p>
                      </div>
                      <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
                        {[
                          ["Expected", h.expected],
                          ["Counted", h.counted],
                          ["Difference", h.variance],
                        ].map(([label, value]) => (
                          <div key={String(label)}>
                            <dt className="text-xs text-muted">{label}</dt>
                            <dd className="mt-1 font-medium tabular-nums">
                              {money(Number(value), currency)}
                            </dd>
                          </div>
                        ))}
                      </dl>
                      {h.note && (
                        <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">
                          {h.note}
                        </p>
                      )}
                      {h.reviews.map((r) => (
                        <p
                          key={r.id}
                          className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground"
                        >
                          {r.action === "APPROVE" ? "Approved" : "Reopened"} by{" "}
                          {r.created_by_name} · {dateTime(r.created_at)}
                          {r.note ? ` · ${r.note}` : ""}
                        </p>
                      ))}
                    </article>
                  ))}
                </div>
              </section>
            )}
          </>
        )
      )}
    </div>
  );
}

export function CashCount({
  data,
  disabled,
  busy,
  onSubmit,
}: {
  data: CashSummary;
  disabled: boolean;
  busy: boolean;
  onSubmit: (
    counted: number,
    denominations: Record<string, number>,
    note: string,
    request: string,
  ) => Promise<void>;
}) {
  const { currency } = useStore();
  const [mode, setMode] = React.useState("total");
  const [amount, setAmount] = React.useState("");
  const [counts, setCounts] = React.useState<Record<string, string>>({});
  const [note, setNote] = React.useState("");
  const request = React.useRef<{ payload: string; id: string } | null>(null);
  const cents =
    mode === "total" ? amountCents(amount) : denominationCents(counts);
  const variance =
    cents === null ? null : cents - Math.round(data.expected * 100);
  return (
    <section className="rounded-xl border border-border bg-surface p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Count the drawer</h2>
        <Badge variant="neutral">Open</Badge>
      </div>
      <form
        className="mt-5 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (cents === null || disabled) return;
          const denominations =
            mode === "total"
              ? {}
              : Object.fromEntries(
                  Object.entries(counts).map(([key, value]) => [
                    key,
                    Number(value || 0),
                  ]),
                );
          const payload = JSON.stringify({
            cents,
            denominations,
            note,
            token: data.count_token,
          });
          if (request.current?.payload !== payload)
            request.current = { payload, id: crypto.randomUUID() };
          void onSubmit(cents / 100, denominations, note, request.current.id);
        }}
      >
        <fieldset disabled={disabled} className="space-y-4">
          <legend className="sr-only">Cash count</legend>
          {currency === "ZAR" && (
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="count-mode"
                  checked={mode === "total"}
                  onChange={() => setMode("total")}
                />
                Enter a total
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="count-mode"
                  checked={mode === "notes"}
                  onChange={() => setMode("notes")}
                />
                Count notes &amp; coins
              </label>
            </div>
          )}
          {mode === "total" ? (
            <div>
              <Label htmlFor="counted-cash">Cash counted ({currency})</Label>
              <Input
                id="counted-cash"
                required
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {DENOMINATIONS.map((d) => (
                <div key={d}>
                  <Label htmlFor={`denom-${d}`}>{money(d, currency)}</Label>
                  <Input
                    id={`denom-${d}`}
                    inputMode="numeric"
                    value={counts[String(d)] ?? ""}
                    placeholder="0"
                    onChange={(e) =>
                      setCounts((prev) => ({
                        ...prev,
                        [String(d)]: e.target.value,
                      }))
                    }
                  />
                </div>
              ))}
            </div>
          )}
          <div>
            <Label htmlFor="cash-note">
              Count note{" "}
              {variance !== null && variance !== 0
                ? "(required for a difference)"
                : "(optional)"}
            </Label>
            <textarea
              id="cash-note"
              className="mt-1 min-h-20 w-full rounded-md border border-border bg-input p-3 text-sm"
              maxLength={1000}
              required={variance !== null && variance !== 0}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </fieldset>
        <div className="flex justify-between gap-3 rounded-lg bg-surface-2 p-4">
          <div>
            <p className="text-xs text-muted">Total counted</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {cents === null ? "—" : money(cents / 100, currency)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted">
              {variance === null || variance === 0
                ? "Difference"
                : variance < 0
                  ? "Short"
                  : "Over"}
            </p>
            <p
              className={`mt-1 text-xl font-semibold tabular-nums ${variance ? "text-warning" : "text-success"}`}
            >
              {variance === null ? "—" : money(variance / 100, currency)}
            </p>
          </div>
        </div>
        <Button
          type="submit"
          className="w-full"
          loading={busy}
          disabled={
            disabled || cents === null || (variance !== 0 && !note.trim())
          }
        >
          Submit for approval
        </Button>
        <p className="text-xs text-muted">
          A manager reviews this count. Submitting does not change stock or
          customer balances.
        </p>
      </form>
    </section>
  );
}

function ReviewCount({
  data,
  disabled,
  busy,
  onReview,
}: {
  data: CashSummary;
  disabled: boolean;
  busy: boolean;
  onReview: (action: string, note: string) => Promise<void>;
}) {
  const { can, currency } = useStore();
  const [note, setNote] = React.useState("");
  const count = data.history[0];
  const approved = data.session?.status === "APPROVED";
  return (
    <section className="rounded-xl border border-border bg-surface p-5 sm:p-6">
      <div className="flex items-center gap-2">
        <CheckCircle2
          className={`size-5 ${approved ? "text-success" : "text-primary-hover"}`}
        />
        <h2 className="text-lg font-semibold">
          {approved ? "Cash-up approved" : "Awaiting manager approval"}
        </h2>
      </div>
      {count && (
        <div className="mt-5 grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted">Cash counted</p>
            <p className="mt-1 text-2xl font-semibold">
              {money(count.counted, currency)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted">Difference at count</p>
            <p
              className={`mt-1 text-2xl font-semibold ${count.variance ? "text-warning" : "text-success"}`}
            >
              {money(count.variance, currency)}
            </p>
          </div>
        </div>
      )}
      {count?.note && (
        <p className="mt-4 whitespace-pre-wrap text-sm text-muted-foreground">
          {count.note}
        </p>
      )}
      {can("manager") ? (
        <div className="mt-5 space-y-3">
          <Label htmlFor="review-note">Manager note / reason to reopen</Label>
          <textarea
            id="review-note"
            value={note}
            maxLength={1000}
            onChange={(e) => setNote(e.target.value)}
            className="min-h-20 w-full rounded-md border border-border bg-input p-3 text-sm"
            disabled={disabled}
          />
          <div className="flex flex-wrap gap-3">
            {!approved && (
              <Button
                loading={busy}
                disabled={
                  disabled ||
                  data.changed_since_count ||
                  (!!count?.variance && !note.trim())
                }
                onClick={() => onReview("APPROVE", note)}
              >
                Approve cash-up
              </Button>
            )}
            <Button
              variant="outline"
              disabled={disabled || !note.trim()}
              onClick={() => onReview("REOPEN", note)}
            >
              Reopen for counting
            </Button>
          </div>
          <p className="text-xs text-muted">
            Reopening requires a reason and preserves all earlier counts and
            approvals.
          </p>
        </div>
      ) : (
        <p className="mt-5 text-sm text-muted">
          Ask a manager to review this count or reopen it for corrections.
        </p>
      )}
    </section>
  );
}

function CashManagement({
  data,
  day,
  disabled,
  run,
}: {
  data: CashSummary;
  day: string;
  disabled: boolean;
  run: (
    action: () => PromiseLike<{ error: { message: string } | null }>,
    message: string,
  ) => Promise<void>;
}) {
  const { store, currency } = useStore();
  const [kind, setKind] = React.useState("REMOVE");
  const [amount, setAmount] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [float, setFloat] = React.useState(
    String(data.session?.opening_float ?? 0),
  );
  const [floatReason, setFloatReason] = React.useState("");
  const request = React.useRef<{ key: string; id: string } | null>(null);
  const cents = amountCents(amount);
  const floatCents = amountCents(float);
  return (
    <details className="rounded-xl border border-border bg-surface p-5">
      <summary className="cursor-pointer text-sm font-semibold">
        Manager tools · cash added, banked or opening float corrections
      </summary>
      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (cents === null || cents <= 0 || disabled) return;
            const key = JSON.stringify([kind, cents, reason, day]);
            if (request.current?.key !== key)
              request.current = { key, id: crypto.randomUUID() };
            void run(
              async () => {
                const result = await createClient().rpc("record_cash_movement", {
                  p_store: store.id,
                  p_day: day,
                  p_kind: kind,
                  p_amount: cents / 100,
                  p_reason: reason,
                  p_request: request.current!.id,
                });
                if (!result.error) { setAmount(""); setReason(""); request.current = null; }
                return result;
              },
              "Cash movement recorded",
            );
          }}
        >
          <h3 className="text-sm font-medium">Other drawer movement</h3>
          <p className="text-xs text-muted">
            Record cash banked, paid out or added for change. Sales and refunds
            are already included above.
          </p>
          <div>
            <Label htmlFor="drawer-kind">Movement</Label>
            <select
              className="h-10 w-full rounded-md border border-border bg-input px-3 text-sm"
              id="drawer-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              <option value="REMOVE">Cash removed / banked</option>
              <option value="ADD">Cash added</option>
            </select>
          </div>
          <div>
            <Label htmlFor="drawer-amount">Amount ({currency})</Label>
            <Input
              id="drawer-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="drawer-reason">Reason</Label>
            <Input
              id="drawer-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={1000}
              required
            />
          </div>
          <Button disabled={disabled || !reason.trim() || !cents}>
            Record movement
          </Button>
        </form>
        {data.session?.status === "OPEN" && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (floatCents === null || !data.session || disabled) return;
              void run(
                () =>
                  createClient().rpc("correct_cash_up_float", {
                    p_cash_up: data.session!.id,
                    p_float: floatCents / 100,
                    p_version: data.session!.version,
                    p_reason: floatReason,
                  }),
                "Opening float corrected",
              );
            }}
          >
            <h3 className="text-sm font-medium">Correct the opening float</h3>
            <p className="text-xs text-muted">
              Use only to correct an opening entry. Later cash added belongs in
              drawer movements.
            </p>
            <div>
              <Label htmlFor="correct-float">
                Correct opening float ({currency})
              </Label>
              <Input
                id="correct-float"
                inputMode="decimal"
                value={float}
                onChange={(e) => setFloat(e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="float-reason">Correction reason</Label>
              <Input
                id="float-reason"
                value={floatReason}
                onChange={(e) => setFloatReason(e.target.value)}
                maxLength={1000}
                required
              />
            </div>
            <Button
              variant="outline"
              disabled={disabled || floatCents === null || !floatReason.trim()}
            >
              Correct float
            </Button>
          </form>
        )}
      </div>
    </details>
  );
}
