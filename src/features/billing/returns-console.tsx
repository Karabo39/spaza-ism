"use client";
import { amountCents } from "@/features/cash-up/cash-utils";
import { statusLabel } from "./status-label";
import { useReturnSources } from "./use-return-sources";
import { SearchSelect } from "@/components/ui/search-select";
import { Fragment, useState } from "react";
import Link from "next/link";
import { DEFAULT_RETURN_REASONS, returnReasonText } from "./return-reasons";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { money, dateTime } from "@/lib/format";
import { useBillingAction } from "./use-billing-action";
type ReturnLine = {
  item_id: string;
  name: string;
  quantity: number;
  condition: string;
  action: string;
  expiry_date?: string;
};
const actions = [
  "RETURN_TO_STOCK",
  "QUARANTINE",
  "SUPPLIER_RETURN",
  "WRITE_OFF",
];
export function ReturnsConsole(props: { initialInvoice?: string }) {
  const { store } = useStore();
  return <StoreReturnsConsole key={store.id} {...props} />;
}
function StoreReturnsConsole({ initialInvoice }: { initialInvoice?: string }) {
  const { store, currency, can } = useStore();
  const { online, busy, request, run } = useBillingAction();
  const [sourceType, setSourceType] = useState(
    initialInvoice ? "invoice" : "sale",
  );
  const [source, setSource] = useState(initialInvoice ?? "");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [lines, setLines] = useState<ReturnLine[]>([]);
  const [item, setItem] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [condition, setCondition] = useState("GOOD");
  const [action, setAction] = useState("RETURN_TO_STOCK");
  const [expiry, setExpiry] = useState("");
  const [reason, setReason] = useState("");
  const [inspection, setInspection] = useState("");
  const [selected, setSelected] = useState("");
  const [decision, setDecision] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("CASH");
  const [reference, setReference] = useState("");
  const [resolution, setResolution] = useState("WRITE_OFF");
  function selectReturn(id: string) {
    setSelected(id);
    setAmount("");
    setReference("");
    setDecision("");
    setMethod("CASH");
  }
  const access = useQuery({
    queryKey: ["billing", "return-access", store.id],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("my_return_access", {
        p_store: store.id,
      });
      if (error) throw error;
      return data as { approve: boolean; refund: boolean };
    },
  });
  const summary = useQuery({
    queryKey: ["billing", "refund-summary", store.id, selected],
    enabled: !!selected,
    queryFn: async () => {
      const { data, error } = await createClient().rpc(
        "return_refund_summary",
        { p_return: selected },
      );
      if (error) throw error;
      return data as {
        approved: number;
        refunded: number;
        available: number;
        reference: string;
      };
    },
  });
  const available = Number(summary.data?.available ?? 0);
  const refundCents = amountCents(amount === "" ? String(available) : amount);
  const refundAmount = refundCents === null ? Number.NaN : refundCents / 100;
  const sources = useReturnSources(store, sourceType, currency);
  const sourceItems = useQuery({
    queryKey: ["billing", "return-source-items", sourceType, source],
    enabled: !!source,
    queryFn: async () => {
      const { data, error } = await createClient()
        .from("v_returnable_items")
        .select("*")
        .eq("store_id", store.id)
        .eq("source_type", sourceType)
        .eq("source_id", source)
        .gt("remaining_quantity", 0);
      if (error) throw error;
      return (data ?? []).map((l) => ({
        id: l.item_id,
        name: l.product_name,
        quantity: Number(l.remaining_quantity),
        originalQuantity: Number(l.quantity),
        charged: Number(l.charged),
      }));
    },
  });
  const returns = useQuery({
    queryKey: ["billing", "returns", store.id],
    queryFn: async () => {
      const { data, error } = await createClient()
        .from("goods_returns")
        .select("*,goods_return_items(id,product_name,quantity)")
        .eq("store_id", store.id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });
  const people = useQuery({
    queryKey: [
      "billing",
      "return-people",
      store.id,
      returns.data?.map((r) => r.created_by).join(","),
    ],
    enabled: !!returns.data?.length,
    queryFn: async () => {
      const ids = [...new Set((returns.data ?? []).map((r) => r.created_by))];
      const { data, error } = await createClient()
        .from("profiles")
        .select("id,full_name")
        .in("id", ids);
      if (error) throw error;
      return data;
    },
  });
  const detail = useQuery({
    queryKey: ["billing", "return-detail", selected],
    enabled: !!selected,
    queryFn: async () => {
      const db = createClient();
      const [items, refunds] = await Promise.all([
        db.from("goods_return_items").select("*").eq("return_id", selected),
        db.from("customer_refunds").select("*").eq("return_id", selected),
      ]);
      if (items.error || refunds.error) throw items.error ?? refunds.error;
      const dispositions = await db
        .from("return_dispositions")
        .select("*")
        .in(
          "return_item_id",
          (items.data ?? []).map((l) => l.id),
        );
      if (dispositions.error) throw dispositions.error;
      return {
        items: items.data ?? [],
        refunds: refunds.data ?? [],
        dispositions: dispositions.data ?? [],
      };
    },
  });
  const current = returns.data?.find((r) => r.id === selected);
  const [reasonDetail, setReasonDetail] = useState("");
  const reasonSettings = useQuery({
    queryKey: ["billing", "return-reasons", store.businessId],
    queryFn: async () => {
      const { data, error } = await createClient()
        .from("billing_settings")
        .select("return_reasons")
        .eq("business_id", store.businessId)
        .maybeSingle();
      if (error) throw error;
      return data?.return_reasons ?? DEFAULT_RETURN_REASONS;
    },
  });
  const reasonValid =
    reasonSettings.data?.includes(reason) &&
    (reason.toLowerCase() !== "other" || !!reasonDetail.trim());
  function add() {
    const found = sourceItems.data?.find((l) => l.id === item);
    if (
      !found ||
      quantity <= 0 ||
      quantity > found.quantity ||
      lines.some((l) => l.item_id === item)
    )
      return;
    setLines((old) => [
      ...old,
      {
        item_id: item,
        name: found.name,
        quantity,
        condition,
        action,
        ...(expiry ? { expiry_date: expiry } : {}),
      },
    ]);
    setItem("");
    setQuantity(1);
  }
  return (
    <div className="min-w-0 break-words space-y-6">
      {!online && (
        <p className="text-warning">
          Returns, inspections and refunds require a connection.
        </p>
      )}
      {source && sourceItems.data?.length === 0 && (
        <p role="status" className="text-sm text-muted">
          No quantities remain available for return on this document. Earlier
          submitted or approved returns already cover its items.
        </p>
      )}
      <section className="rounded-lg border border-border bg-surface p-5 space-y-3">
        <h2 className="font-semibold">Capture a return</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="return-source-type">Original document</Label>
            <select
              id="return-source-type"
              className="h-11 sm:h-10 min-w-0 w-full rounded border border-border bg-input px-2"
              value={sourceType}
              onChange={(e) => {
                setSourceType(e.target.value);
                setSource("");
                setLines([]);
                setItem("");
              }}
            >
              <option value="sale">Checkout sale</option>
              <option value="invoice">Issued invoice</option>
            </select>
          </div>
          <div>
            <SearchSelect
              label="Select original sale / invoice"
              options={sources.data ?? []}
              value={source}
              onChange={(id) => {
                setSource(id);
                setLines([]);
                setItem("");
              }}
            />
          </div>
        </div>
        <p className="text-xs text-muted">
          Showing the latest 100 returnable documents. Submitted returns reserve
          their quantities. For an older sale or invoice, enter its full
          reference ID below.
        </p>
        <Input
          aria-label="Original document ID"
          placeholder="Original document ID"
          value={source}
          onChange={(e) => {
            setSource(e.target.value);
            setLines([]);
            setItem("");
          }}
        />
        {(sources.error || sourceItems.error) && (
          <p role="alert" className="text-danger">
            Could not load the selected document. Check its ID and your
            connection.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="return-product">Product sold</Label>
            <select
              id="return-product"
              className="h-11 sm:h-10 min-w-0 w-full rounded border border-border bg-input px-2"
              value={item}
              onChange={(e) => setItem(e.target.value)}
            >
              <option value="">Select item</option>
              {sourceItems.data
                ?.filter((l) => !lines.some((added) => added.item_id === l.id))
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} · {l.quantity} remaining ·{" "}
                    {money(l.charged / l.originalQuantity, currency)} per unit
                    charged
                  </option>
                ))}
            </select>
            {item &&
              sourceItems.data
                ?.filter((l) => l.id === item)
                .map((l) => (
                  <p key={l.id} className="mt-2 text-xs text-muted">
                    Estimated return value:{" "}
                    {money(
                      (l.charged * quantity) / l.originalQuantity,
                      currency,
                    )}{" "}
                    for {quantity} unit(s). Uses the original charged price,
                    including discounts and tax. Expiry is a reason, not a fee;
                    earlier returns and payments determine the final refundable
                    amount.
                  </p>
                ))}
          </div>
          <div>
            <Label htmlFor="return-quantity">Quantity returned</Label>
            <Input
              id="return-quantity"
              type="number"
              min="0.001"
              step="0.001"
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
            />
          </div>
          <div>
            <Label htmlFor="return-condition">Condition</Label>
            <select
              id="return-condition"
              className="h-11 sm:h-10 min-w-0 w-full rounded border border-border bg-input px-2"
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
            >
              {["GOOD", "DAMAGED", "EXPIRED", "OTHER"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="return-action">Inventory action</Label>
            <select
              id="return-action"
              className="h-11 sm:h-10 min-w-0 w-full rounded border border-border bg-input px-2"
              value={action}
              onChange={(e) => setAction(e.target.value)}
            >
              {actions.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="return-expiry">Expiry on returned item</Label>
            <Input
              id="return-expiry"
              type="date"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
            />
          </div>
          <Button
            className="self-end"
            variant="secondary"
            disabled={!item || quantity <= 0}
            onClick={add}
          >
            Add return item
          </Button>
        </div>
        {lines.map((l) => (
          <div
            key={l.item_id}
            className="flex items-center justify-between border-b border-border py-2"
          >
            <p className="text-sm">
              {l.quantity} × {l.name} · {l.condition} · {statusLabel(l.action)}
            </p>
            <Button
              variant="ghost"
              onClick={() =>
                setLines((old) => old.filter((x) => x.item_id !== l.item_id))
              }
            >
              Remove
            </Button>
          </div>
        ))}
        <Label htmlFor="return-reason">Reason for return</Label>
        <select
          id="return-reason"
          className="h-11 sm:h-10 min-w-0 w-full rounded border border-border bg-input px-2"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        >
          <option value="">Choose a configured reason</option>
          {reasonSettings.data?.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
        {reasonSettings.error && (
          <p role="alert" className="text-danger">
            Could not load return reasons. Refresh before submitting.
          </p>
        )}
        <Label htmlFor="return-reason-detail">
          Explanation{" "}
          {reason.toLowerCase() === "other" ? "(required)" : "(optional)"}
        </Label>
        <Input
          id="return-reason-detail"
          maxLength={900}
          value={reasonDetail}
          onChange={(e) => setReasonDetail(e.target.value)}
        />
        <Label htmlFor="return-inspection">Inspection findings</Label>
        <Input
          id="return-inspection"
          value={inspection}
          onChange={(e) => setInspection(e.target.value)}
        />
        <Button
          loading={busy}
          disabled={
            !online || !lines.length || !reasonValid || !inspection.trim()
          }
          onClick={() => {
            const payload = {
              p_source_type: sourceType,
              p_source: source,
              p_items: lines.map(({ name, ...line }) => {
                void name;
                return line;
              }),
              p_reason: returnReasonText(reason, reasonDetail),
              p_inspection: inspection,
            };
            void run(
              async () => {
                const res = await createClient().rpc("submit_goods_return", {
                  ...payload,
                  p_request: request(payload),
                });
                if (res.data) selectReturn(res.data);
                return res;
              },
              "Return submitted",
              () => {
                setLines([]);
                setReason("");
                setReasonDetail("");
                setInspection("");
              },
            );
          }}
        >
          Submit return for processing
        </Button>
      </section>
      <h2 className="font-semibold">Recent returns</h2>
      {returns.error && <p role="alert">Could not load returns.</p>}
      <Table>
        <THead>
          <TR>
            <TH>Reference</TH>
            <TH>Status</TH>
            <TH>Reason</TH>
            <TH>Returned by</TH>
            <TH>Value</TH>
          </TR>
        </THead>
        <TBody>
          {returns.data?.map((r) => (
            <Fragment key={r.id}>
              <TR>
                <TD>
                  <button
                    className="focus-ring inline-flex items-center rounded-md border border-accent/40 px-3 py-2 text-sm font-medium text-accent hover:bg-accent/10"
                    aria-expanded={expanded === r.id}
                    onClick={() => {
                      selectReturn(r.id);
                      setExpanded(expanded === r.id ? null : r.id);
                    }}
                  >
                    <span aria-hidden="true">
                      {expanded === r.id ? "▾" : "▸"}
                    </span>{" "}
                    {r.reference}
                  </button>
                </TD>
                <TD>{statusLabel(r.status)}</TD>
                <TD>{r.reason}</TD>
                <TD>
                  {people.data?.find((p) => p.id === r.created_by)?.full_name ??
                    "User unavailable"}
                </TD>
                <TD>{money(r.amount, currency)}</TD>
              </TR>
              {expanded === r.id && (
                <TR>
                  <TD colSpan={5}>
                    <ul className="space-y-1 py-2">
                      {(r.goods_return_items ?? []).map((l) => (
                        <li key={l.id}>
                          {l.quantity} × {l.product_name}
                        </li>
                      ))}
                    </ul>
                  </TD>
                </TR>
              )}
            </Fragment>
          ))}
        </TBody>
      </Table>
      {current && (
        <section className="rounded-lg border border-border bg-surface p-5 space-y-4">
          <h2 className="font-semibold">
            {current.reference} · {statusLabel(current.status)}
          </h2>
          <p>{current.inspection}</p>
          {current.status === "APPROVED" && (
            <Link
              href={`/returns/${current.id}/receipt`}
              className="focus-ring inline-flex items-center rounded-md border border-accent/40 px-3 py-2 text-sm font-medium text-accent hover:bg-accent/10"
            >
              Print credit note / return receipt
            </Link>
          )}
          {detail.data?.items.map((l) => (
            <div key={l.id} className="border-b border-border py-3 text-sm">
              <p>
                {l.quantity} × {l.product_name} · {l.condition} ·{" "}
                {statusLabel(l.inventory_action)} · {money(l.amount, currency)}
              </p>
              {detail.data?.dispositions
                .filter((d) => d.return_item_id === l.id)
                .map((d) => (
                  <p key={d.id}>
                    Resolved: {statusLabel(d.action)} · {d.reason}
                  </p>
                ))}
              {can("manager") &&
                current.status === "APPROVED" &&
                l.inventory_action === "QUARANTINE" &&
                !detail.data?.dispositions.some(
                  (d) => d.return_item_id === l.id,
                ) && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <select
                      aria-label="Quarantine decision"
                      className="rounded border border-border bg-input px-2"
                      value={resolution}
                      onChange={(e) => setResolution(e.target.value)}
                    >
                      {actions
                        .filter((a) => a !== "QUARANTINE")
                        .map((a) => (
                          <option key={a} value={a}>
                            {statusLabel(a)}
                          </option>
                        ))}
                    </select>
                    <Input
                      aria-label="Inspected expiry date"
                      type="date"
                      className="w-44"
                      value={expiry}
                      onChange={(e) => setExpiry(e.target.value)}
                    />
                    <Input
                      aria-label="Quarantine inspection reason"
                      placeholder="Inspection / decision reason"
                      value={decision}
                      onChange={(e) => setDecision(e.target.value)}
                    />
                    <Button
                      size="sm"
                      disabled={!online || busy || !decision.trim()}
                      onClick={() =>
                        run(
                          () =>
                            createClient().rpc("resolve_return_quarantine", {
                              p_item: l.id,
                              p_action: resolution,
                              p_reason: decision,
                              ...(expiry ? { p_expiry: expiry } : {}),
                            }),
                          "Quarantine resolved",
                        )
                      }
                    >
                      Resolve quarantine
                    </Button>
                  </div>
                )}
            </div>
          ))}
          {access.data?.approve && current.status === "SUBMITTED" && (
            <div className="space-y-3">
              <Input
                aria-label="Return decision reason"
                placeholder="Reason (required for rejection)"
                value={decision}
                onChange={(e) => setDecision(e.target.value)}
              />
              <div className="flex flex-wrap gap-3">
                <Button
                  disabled={!online}
                  loading={busy}
                  onClick={() =>
                    run(
                      () =>
                        createClient().rpc("process_goods_return", {
                          p_return: current.id,
                          p_approve: true,
                        }),
                      "Return approved and credit recorded",
                    )
                  }
                >
                  Approve return
                </Button>
                <Button
                  variant="secondary"
                  disabled={!online || busy || !decision.trim()}
                  onClick={() =>
                    run(
                      () =>
                        createClient().rpc("process_goods_return", {
                          p_return: current.id,
                          p_approve: false,
                          p_reason: decision,
                        }),
                      "Return rejected",
                    )
                  }
                >
                  Reject return
                </Button>
              </div>
            </div>
          )}
          {current.status === "APPROVED" && (
            <>
              <p className="text-sm">
                Approved value: {money(current.amount, currency)}. Refunded:{" "}
                {money(Number(summary.data?.refunded ?? 0), currency)}. Customer
                account credit is reduced by refunds and any other amounts owed.
              </p>
              {access.data?.refund &&
                available > 0 &&
                !summary.isFetching &&
                !summary.error && (
                  <div className="space-y-3">
                    <h3 className="font-semibold">Record refund paid</h3>
                    <p className="text-sm text-muted-foreground">
                      Enter an amount with up to two decimal places, within the
                      remaining refundable balance.
                    </p>
                    <div className="flex flex-wrap gap-3">
                      <Input
                        aria-label="Refund amount"
                        type="number"
                        min="0.01"
                        step="0.01"
                        placeholder="Refund amount"
                        max={available}
                        value={amount === "" ? available : amount}
                        onChange={(e) => setAmount(e.target.value)}
                      />
                      <select
                        aria-label="Refund method"
                        className="rounded border border-border bg-input px-2"
                        value={method}
                        onChange={(e) => setMethod(e.target.value)}
                      >
                        <option value="CASH">Cash</option>
                        <option value="CARD_EFT">Card/EFT</option>
                      </select>
                      <Input
                        aria-label="Refund payment reference"
                        placeholder="Payment reference"
                        value={reference || summary.data?.reference || ""}
                        onChange={(e) => setReference(e.target.value)}
                      />
                      <Input
                        aria-label="Refund reason"
                        placeholder="Refund reason"
                        value={decision}
                        onChange={(e) => setDecision(e.target.value)}
                      />
                    </div>
                    <Button
                      loading={busy}
                      disabled={
                        !online ||
                        !Number.isFinite(refundAmount) ||
                        refundAmount <= 0 ||
                        refundAmount > available ||
                        !decision.trim()
                      }
                      onClick={() => {
                        const payload = {
                          p_return: current.id,
                          p_amount: refundAmount,
                          p_method: method,
                          p_reason: decision,
                          p_reference:
                            reference || summary.data?.reference || "",
                        };
                        void run(
                          () =>
                            createClient().rpc("record_customer_refund", {
                              ...payload,
                              p_request: request(payload),
                            }),
                          "Refund recorded",
                          () => {
                            setAmount("");
                            setReference("");
                            setDecision("");
                          },
                        );
                      }}
                    >
                      Record refund
                    </Button>
                  </div>
                )}
              {summary.error ? (
                <p role="alert">
                  Could not check the refundable balance.{" "}
                  <Button onClick={() => summary.refetch()}>Retry</Button>
                </p>
              ) : (
                summary.data && (
                  <p className="rounded border border-border p-3">
                    Remaining refundable: {money(available, currency)}.{" "}
                    {Number(summary.data.refunded) >= Number(current.amount)
                      ? "Fully refunded. Payment history is read-only."
                      : available <= 0
                        ? "No cash refund available. This return may have reduced customer debt or its credit may have been used."
                        : "Refunds use the original transaction value, including discounts and tax."}
                  </p>
                )
              )}
              {detail.data?.refunds.map((f) => (
                <p key={f.id} className="text-sm">
                  {f.reference} · {money(f.amount, currency)} · {f.method} ·{" "}
                  {dateTime(f.created_at)}
                </p>
              ))}
            </>
          )}
        </section>
      )}
    </div>
  );
}
