"use client";
import { useState } from "react";
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
  const refundAmount = amount === "" ? available : Number(amount);
  const sources = useQuery({
    queryKey: ["billing", "return-sources", store.id, sourceType],
    queryFn: async () => {
      const db = createClient();
      if (sourceType === "invoice") {
        const { data, error } = await db
          .from("sales_invoices")
          .select("*")
          .eq("store_id", store.id)
          .not("goods_issued_at", "is", null)
          .order("created_at", { ascending: false })
          .limit(100);
        if (error) throw error;
        return (data ?? []).map((i) => ({
          id: i.id,
          label: `${i.reference} · ${i.customer_name}`,
        }));
      }
      const { data, error } = await db
        .from("goods_out")
        .select("*")
        .eq("store_id", store.id)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      const ids = (data ?? []).map((s) => s.id);
      const { data: sold, error: soldError } = ids.length
        ? await db
            .from("goods_out_items")
            .select("goods_out_id,product_id,quantity")
            .in("goods_out_id", ids)
        : { data: [], error: null };
      if (soldError) throw soldError;
      const productIds = [...new Set((sold ?? []).map((l) => l.product_id))];
      const { data: names, error: namesError } = productIds.length
        ? await db.from("products").select("id,name").in("id", productIds)
        : { data: [], error: null };
      if (namesError) throw namesError;
      return (data ?? []).map((s) => ({
        id: s.id,
        label: `${dateTime(s.created_at)} · ${money(s.total_amount, currency)} · ${(
          sold ?? []
        )
          .filter((l) => l.goods_out_id === s.id)
          .map(
            (l) =>
              `${l.quantity} × ${names?.find((p) => p.id === l.product_id)?.name ?? "Product"}`,
          )
          .join(", ")} · ${s.id.slice(-6)}`,
      }));
    },
  });
  const sourceItems = useQuery({
    queryKey: ["billing", "return-source-items", sourceType, source],
    enabled: !!source,
    queryFn: async () => {
      const db = createClient();
      if (sourceType === "invoice") {
        const { data, error } = await db
          .from("sales_invoice_items")
          .select("*")
          .eq("invoice_id", source);
        if (error) throw error;
        return (data ?? []).map((l) => ({
          id: l.id,
          name: l.product_name,
          quantity: Number(l.quantity),
        }));
      }
      const { data, error } = await db
        .from("goods_out_items")
        .select("*")
        .eq("goods_out_id", source);
      if (error) throw error;
      const products = await db
        .from("products")
        .select("id,name")
        .in(
          "id",
          (data ?? []).map((l) => l.product_id),
        );
      if (products.error) throw products.error;
      return (data ?? []).map((l) => ({
        id: l.id,
        name:
          products.data?.find((p) => p.id === l.product_id)?.name ??
          l.product_id,
        quantity: Number(l.quantity),
      }));
    },
  });
  const returns = useQuery({
    queryKey: ["billing", "returns", store.id],
    queryFn: async () => {
      const { data, error } = await createClient()
        .from("goods_returns")
        .select("*")
        .eq("store_id", store.id)
        .order("created_at", { ascending: false })
        .limit(200);
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
    <div className="space-y-6">
      {!online && (
        <p className="text-warning">
          Returns, inspections and refunds require a connection.
        </p>
      )}
      <section className="rounded-lg border border-border bg-surface p-5 space-y-3">
        <h2 className="font-semibold">Capture a return</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="return-source-type">Original document</Label>
            <select
              id="return-source-type"
              className="h-10 w-full rounded border border-border bg-input px-2"
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
            <Label htmlFor="return-source">
              Select original sale / invoice
            </Label>
            <select
              id="return-source"
              className="h-10 w-full rounded border border-border bg-input px-2"
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                setLines([]);
                setItem("");
              }}
            >
              <option value="">Select a document</option>
              {initialInvoice &&
                !sources.data?.some((s) => s.id === initialInvoice) && (
                  <option value={initialInvoice}>{initialInvoice}</option>
                )}
              {sources.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-xs text-muted">
          Showing the latest 100 documents. For an older sale or invoice, enter
          its full reference ID below.
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
              className="h-10 w-full rounded border border-border bg-input px-2"
              value={item}
              onChange={(e) => setItem(e.target.value)}
            >
              <option value="">Select item</option>
              {sourceItems.data?.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} · {l.quantity} sold
                </option>
              ))}
            </select>
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
              className="h-10 w-full rounded border border-border bg-input px-2"
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
              className="h-10 w-full rounded border border-border bg-input px-2"
              value={action}
              onChange={(e) => setAction(e.target.value)}
            >
              {actions.map((s) => (
                <option key={s} value={s}>
                  {s.replaceAll("_", " ")}
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
              {l.quantity} × {l.name} · {l.condition} ·{" "}
              {l.action.replaceAll("_", " ")}
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
          className="h-10 w-full rounded border border-border bg-input px-2"
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
            <TH>Value</TH>
          </TR>
        </THead>
        <TBody>
          {returns.data?.map((r) => (
            <TR key={r.id}>
              <TD>
                <button
                  className="text-accent"
                  onClick={() => selectReturn(r.id)}
                >
                  {r.reference}
                </button>
              </TD>
              <TD>{r.status}</TD>
              <TD>{r.reason}</TD>
              <TD>{money(r.amount, currency)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
      {current && (
        <section className="rounded-lg border border-border bg-surface p-5 space-y-4">
          <h2 className="font-semibold">
            {current.reference} · {current.status}
          </h2>
          <p>{current.inspection}</p>
          {current.status === "APPROVED" && (
            <Link
              href={`/returns/${current.id}/receipt`}
              className="inline-block text-accent"
            >
              Print credit note / return receipt
            </Link>
          )}
          {detail.data?.items.map((l) => (
            <div key={l.id} className="border-b border-border py-3 text-sm">
              <p>
                {l.quantity} × {l.product_name} · {l.condition} ·{" "}
                {l.inventory_action.replaceAll("_", " ")} ·{" "}
                {money(l.amount, currency)}
              </p>
              {detail.data?.dispositions
                .filter((d) => d.return_item_id === l.id)
                .map((d) => (
                  <p key={d.id}>
                    Resolved: {d.action.replaceAll("_", " ")} · {d.reason}
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
                            {a.replaceAll("_", " ")}
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
              <div className="flex gap-3">
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
