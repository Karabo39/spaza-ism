"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Trash2,
  Plus,
  Minus,
  UserPlus,
  PackageSearch,
  ShieldAlert,
} from "lucide-react";
import { ScanInput } from "@/features/scan/scan-input";
import { ProductSearchDialog } from "@/features/scan/product-search-dialog";
import { ProductRegisterDialog } from "@/features/products/product-register-dialog";
import { CustomerPicker } from "@/features/credit/customer-picker";
import { OverrideApproval } from "@/features/credit/override-approval";
import { lookupByCode } from "@/features/scan/lookup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/misc";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store-context";
import { useOffline } from "@/lib/offline/offline-context";
import { enqueueSaleAndAdjust } from "@/lib/offline/db";
import { money, qty, friendlyError } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ProductStock, CreditCustomer } from "@/lib/db/database.types";
import Link from "next/link";
import { PaymentFields } from "./payment-fields";
import {
  emptyPayments,
  paymentSummary,
  type PaymentMode,
  type PaymentDraft,
} from "./payments";
import { ReceiptHistory } from "./receipt-history";

type Line = {
  productId: string;
  name: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  stock: number;
  trackExpiry: boolean;
};

function isNetworkError(message?: string) {
  const m = (message ?? "").toLowerCase();
  return (
    m.includes("fetch") ||
    m.includes("network") ||
    m.includes("failed to fetch") ||
    m === ""
  );
}

export function GoodsOutConsole() {
  const router = useRouter();
  const { store, currency, can, user } = useStore();
  const { online, refresh: refreshOffline } = useOffline();
  const [lines, setLines] = React.useState<Line[]>([]);
  const [saleType, setSaleType] = React.useState<PaymentMode>("CASH");
  const [payments, setPayments] = React.useState<PaymentDraft>({
    ...emptyPayments,
  });
  const [till, setTill] = React.useState("");
  const [savedSale, setSavedSale] = React.useState<string | null>(null);
  const [savedTotal, setSavedTotal] = React.useState(0);
  const [uncertain, setUncertain] = React.useState(false);
  const submitting = React.useRef(false);
  const attempt = React.useRef<{ id: string; fingerprint: string } | null>(
    null,
  );
  const [customer, setCustomer] = React.useState<CreditCustomer | null>(null);
  const [override, setOverride] = React.useState(false);
  const [approval, setApproval] = React.useState<{
    key: string;
    token: string;
  } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [registerOpen, setRegisterOpen] = React.useState(false);
  const [unknownCode, setUnknownCode] = React.useState("");

  const journalKey = `pos-checkout:${user.id}:${store.id}`;
  const [recovered, setRecovered] = React.useState(false);
  React.useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (!active) return;
      try {
        const raw = localStorage.getItem(journalKey);
        if (raw) {
          const pending = JSON.parse(raw);
          setLines(pending.lines);
          setSaleType(pending.saleType);
          setPayments(pending.payments);
          setCustomer(pending.customer);
          setOverride(pending.override);
          setTill(pending.till);
          attempt.current = pending.attempt;
          setUncertain(true);
        }
      } catch {
        toast.error(
          "Could not restore a pending checkout. Check saved receipts before taking another payment.",
        );
      }
      setRecovered(true);
    });
    return () => {
      active = false;
    };
  }, [journalKey]);
  function clearJournal() {
    try {
      localStorage.removeItem(journalKey);
    } catch {
      toast.warning(
        "Browser storage could not be cleared. A retry will reopen the same saved receipt.",
      );
    }
  }

  const total = React.useMemo(
    () =>
      lines.reduce(
        (sum, l) => sum + Math.round(l.quantity * l.unitPrice * 100) / 100,
        0,
      ),
    [lines],
  );

  const payment = paymentSummary(saleType, payments, total);
  const projectedBalance = (customer?.balance ?? 0) + total;
  const wouldExceed = !!customer && projectedBalance > customer.credit_limit;
  const approvalKey = `${store.id}:${customer?.customer_id}:${total}`;
  const approvalToken =
    approval?.key === approvalKey ? approval.token : undefined;

  function addProduct(p: ProductStock) {
    setLines((prev) => {
      const existing = prev.find((l) => l.productId === p.id);
      if (existing) {
        return prev.map((l) =>
          l.productId === p.id ? { ...l, quantity: l.quantity + 1 } : l,
        );
      }
      return [
        ...prev,
        {
          productId: p.id,
          name: p.name,
          unit: p.unit,
          quantity: 1,
          unitPrice: Number(p.selling_price),
          stock: Number(p.quantity),
          trackExpiry: p.track_expiry,
        },
      ];
    });
  }

  async function onScan(code: string) {
    setBusy(true);
    const hit = await lookupByCode(store.id, code);
    setBusy(false);
    if ("product" in hit) {
      if (hit.product.stock_status === "out")
        toast.warning(`${hit.product.name} is out of stock`);
      addProduct(hit.product);
    } else {
      setUnknownCode(code);
      toast.error(`No product for "${code}"`, {
        action: { label: "Register", onClick: () => setRegisterOpen(true) },
      });
    }
  }

  function setQty(id: string, q: number) {
    setLines((prev) =>
      prev.map((l) =>
        l.productId === id ? { ...l, quantity: Math.max(0.001, q) } : l,
      ),
    );
  }
  function setPrice(id: string, p: number) {
    setLines((prev) =>
      prev.map((l) =>
        l.productId === id ? { ...l, unitPrice: Math.max(0, p) } : l,
      ),
    );
  }
  function remove(id: string) {
    setLines((prev) => prev.filter((l) => l.productId !== id));
  }

  function resetCart() {
    clearJournal();
    setLines([]);
    setCustomer(null);
    setOverride(false);
    setSaleType("CASH");
    setPayments({ ...emptyPayments });
    setUncertain(false);
    setApproval(null);
    attempt.current = null;
  }

  async function saveOffline() {
    if (lines.some((line) => line.trackExpiry)) {
      setUncertain(true);
      toast.error(
        "Expiry-tracked stock needs a connection so its batch dates can be checked. This sale has not been queued.",
      );
      return;
    }
    await enqueueSaleAndAdjust({
      id: attempt.current?.id ?? crypto.randomUUID(),
      storeId: store.id,
      actorId: user.id,
      payments: payment.payments,
      till,
      items: lines.map((l) => ({
        product_id: l.productId,
        quantity: l.quantity,
        unit_price: l.unitPrice,
      })),
      total,
      createdAt: Date.now(),
      status: "pending",
    });
    toast.success(
      `Saved offline — ${money(total, currency)}. It will sync when you're back online.`,
    );
    clearJournal();
    resetCart();
    await refreshOffline();
  }

  async function complete() {
    if (submitting.current) return;
    if (uncertain && attempt.current) {
      submitting.current = true;
      setBusy(true);
      try {
        const { data, error } = await createClient()
          .from("goods_out")
          .select("id,total_amount")
          .eq("store_id", store.id)
          .eq("performed_by", user.id)
          .eq("request_id", attempt.current.id)
          .maybeSingle();
        if (error) {
          toast.error("Could not check the saved sale. Reconnect and retry.");
          return;
        }
        if (data) {
          setSavedTotal(Number(data.total_amount));
          setSavedSale(data.id);
          resetCart();
          router.refresh();
          return;
        }
      } catch {
        toast.error("Could not check the saved sale. Reconnect and retry.");
        return;
      } finally {
        submitting.current = false;
        setBusy(false);
      }
    }
    if (!payment.valid) {
      toast.error(
        payment.error || "Record the full payment before completing this sale.",
      );
      return;
    }
    if (store.locationType === "warehouse") {
      toast.error("Warehouse stock cannot be sold.");
      return;
    }
    if (lines.length === 0) return;
    if (saleType === "CREDIT" && !customer) {
      toast.error("Select a customer for credit sale");
      return;
    }
    if (saleType === "CREDIT" && wouldExceed && !uncertain && !override && !approvalToken) {
      toast.error(
        "Ask a manager to approve this amount before completing the sale.",
      );
      return;
    }
    const fingerprint = JSON.stringify({
      lines,
      saleType,
      customer: customer?.customer_id,
      override,
      payments,
      till,
    });
    if (attempt.current?.fingerprint !== fingerprint)
      attempt.current = { id: crypto.randomUUID(), fingerprint };

    if (!navigator.onLine && lines.some((line) => line.trackExpiry)) {
      toast.error("Expiry-tracked stock requires a connection.");
      return;
    }
    try {
      localStorage.setItem(
        journalKey,
        JSON.stringify({
          lines,
          saleType,
          payments,
          customer,
          override,
          till,
          attempt: attempt.current,
        }),
      );
    } catch {
      toast.error(
        "Enable browser storage before completing a sale so interrupted payments can be recovered.",
      );
      return;
    }
    // Offline: capture cash sales locally; credit needs the server (limit checks).
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      if (saleType !== "CASH") {
        toast.error(
          "Card/EFT and credit sales need a connection. Reconnect to record this sale.",
        );
        return;
      }
      submitting.current = true;
      setBusy(true);
      try {
        await saveOffline();
      } catch {
        setUncertain(true);
        toast.error("Could not queue this sale. Keep it open and retry.");
      } finally {
        submitting.current = false;
        setBusy(false);
      }
      return;
    }

    submitting.current = true;
    setBusy(true);
    const supabase = createClient();
    try {
      const { data, error } = await supabase.rpc("complete_checkout", {
        p_store: store.id,
        p_credit: saleType === "CREDIT",
        p_payments: payment.payments,
        p_till: till,
        p_customer: saleType === "CREDIT" ? customer!.customer_id : null,
        p_items: lines.map((l) => ({
          product_id: l.productId,
          quantity: l.quantity,
          unit_price: l.unitPrice,
        })),
        p_override: saleType === "CREDIT" && override,
        p_request: attempt.current.id,
        ...(saleType === "CREDIT" && approvalToken
          ? { p_override_token: approvalToken }
          : {}),
      });
      setBusy(false);
      if (error || !data) {
        const unconfirmed =
          error?.message.includes("REQUEST_CONFLICT") ||
          isNetworkError(error?.message) ||
          !/^[0-9A-Z]{5}$/.test(error?.code ?? "");
        if (saleType === "CASH" && unconfirmed && !error?.message.includes("REQUEST_CONFLICT")) {
          setBusy(true);
          await saveOffline();
          setBusy(false);
          return;
        }
        if (unconfirmed) setUncertain(true);
        else {
          clearJournal();
          setUncertain(false);
        }
        toast.error(friendlyError(error?.message));
        return;
      }
      toast.success(
        saleType === "CREDIT"
          ? `Credit sale to ${customer?.name} — ${money(total, currency)}`
          : `${saleType === "SPLIT" ? "Split payment" : saleType} sale complete — ${money(total, currency)}`,
      );
      clearJournal();
      setSavedTotal(total);
      setSavedSale(data);
      resetCart();
      router.refresh();
    } catch {
      setBusy(false);
      if (saleType === "CASH") {
        try {
          await saveOffline();
        } catch {
          setUncertain(true);
          toast.error("Could not queue this sale. Keep it open and retry.");
        }
        return;
      }
      setUncertain(true);
      toast.error(
        "The result is not confirmed. Retry this same sale when connected; do not take another payment.",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {savedSale && (
        <section
          role="status"
          className="rounded-lg border border-success p-4 space-y-3"
        >
          <h2 className="font-semibold">
            Sale saved. Would you like a receipt?
          </h2>
          <p className="break-all text-sm">
            {money(savedTotal, currency)} · POS-
            {savedSale.replaceAll("-", "").toUpperCase()}
          </p>
          <div className="flex gap-2">
            <Button asChild>
              <Link href={`/goods-out/${savedSale}/receipt`}>
                Print Receipt
              </Link>
            </Button>
            <Button
              variant="secondary"
              onClick={async () => {
                const { error } = await createClient().rpc(
                  "record_receipt_print",
                  { p_sale: savedSale, p_action: "DECLINED" },
                );
                if (error) {
                  toast.error(
                    "Could not record your choice. The sale remains saved.",
                  );
                  return;
                }
                setSavedSale(null);
              }}
            >
              Don’t Print
            </Button>
          </div>
        </section>
      )}
      {uncertain && (
        <section role="alert" className="rounded border border-warning p-4">
          <p>
            The result has not been confirmed. Do not collect another payment or
            cancel this sale.
          </p>
          <Button disabled={busy} onClick={complete}>
            Retry and check this sale
          </Button>
        </section>
      )}
      <fieldset
        disabled={!recovered || busy || uncertain}
        className="grid min-w-0 gap-5 lg:grid-cols-[1fr_20rem]"
      >
        <div className="space-y-4">
          <ScanInput onScan={onScan} busy={busy} />
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted">
              {lines.length} item{lines.length === 1 ? "" : "s"} in cart
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setSearchOpen(true)}>
                <PackageSearch className="size-4" /> Add Product
              </Button>
              <Button
                size="sm"
                disabled={!lines.length}
                onClick={() => {
                  resetCart();
                  toast.success("Sale cancelled. Ready for the next customer.");
                }}
              >
                Cancel Sale
              </Button>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-surface">
            {lines.length === 0 ? (
              <EmptyState
                icon={PackageSearch}
                title="Scan to start a sale"
                description="Scan a barcode or use “Add product”. Items appear here."
              />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Product</TH>
                    <TH className="w-40 text-center">Qty</TH>
                    <TH className="w-32 text-right">Unit price</TH>
                    <TH className="w-28 text-right">Total</TH>
                    <TH className="w-10" />
                  </TR>
                </THead>
                <TBody>
                  {lines.map((l) => {
                    const over = l.quantity > l.stock;
                    return (
                      <TR key={l.productId}>
                        <TD>
                          <p className="font-medium">{l.name}</p>
                          <p
                            className={cn(
                              "text-xs",
                              over ? "text-danger" : "text-muted",
                            )}
                          >
                            {over
                              ? `Only ${qty(l.stock)} in stock`
                              : `${qty(l.stock)} ${l.unit} available`}
                          </p>
                        </TD>
                        <TD>
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7"
                              onClick={() =>
                                setQty(l.productId, l.quantity - 1)
                              }
                            >
                              <Minus className="size-3.5" />
                            </Button>
                            <Input
                              value={l.quantity}
                              onChange={(e) =>
                                setQty(l.productId, Number(e.target.value) || 0)
                              }
                              type="number"
                              step="0.001"
                              min="0.001"
                              className="h-8 w-16 text-center"
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7"
                              onClick={() =>
                                setQty(l.productId, l.quantity + 1)
                              }
                            >
                              <Plus className="size-3.5" />
                            </Button>
                          </div>
                        </TD>
                        <TD className="text-right">
                          <Input
                            value={l.unitPrice}
                            onChange={(e) =>
                              setPrice(l.productId, Number(e.target.value) || 0)
                            }
                            type="number"
                            step="0.01"
                            min="0"
                            className="h-8 w-24 text-right ml-auto"
                          />
                        </TD>
                        <TD className="text-right font-medium tabular-nums">
                          {money(l.quantity * l.unitPrice, currency)}
                        </TD>
                        <TD>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-muted hover:text-danger"
                            onClick={() => remove(l.productId)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            )}
          </div>
        </div>

        {/* Checkout panel */}
        <div className="lg:sticky lg:top-20 h-fit space-y-4 rounded-lg border border-border bg-surface p-4">
          <div>
            <p className="mb-2 text-xs font-medium text-muted">Payment type</p>
            <div className="grid grid-cols-3 gap-2">
              {(["CASH", "CARD", "EFT", "SPLIT", "CREDIT"] as const).map(
                (mode) => (
                  <button
                    key={mode}
                    disabled={!online && mode !== "CASH"}
                    aria-pressed={saleType === mode}
                    onClick={() => {
                      setSaleType(mode);
                      setPayments({ ...emptyPayments });
                    }}
                    className={cn(
                      "rounded-md border py-2.5 text-sm font-medium disabled:opacity-50",
                      saleType === mode
                        ? "border-primary/50 bg-primary/15 text-primary-hover"
                        : "border-border hover:bg-surface-2",
                    )}
                  >
                    {mode === "SPLIT"
                      ? "Split"
                      : mode === "EFT"
                        ? "EFT"
                        : mode.charAt(0) + mode.slice(1).toLowerCase()}
                  </button>
                ),
              )}
            </div>
          </div>
          <PaymentFields
            mode={saleType}
            draft={payments}
            onChange={setPayments}
            total={total}
            currency={currency}
          />
          <label className="block text-xs">
            Till / terminal name (optional)
            <Input
              maxLength={80}
              value={till}
              onChange={(e) => setTill(e.target.value)}
              placeholder="For example: Front counter"
            />
          </label>

          {saleType === "CREDIT" ? (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted">Customer</p>
              {customer ? (
                <div className="rounded-md border border-border bg-surface-2 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">{customer.name}</p>
                    <button
                      className="text-xs text-accent hover:underline"
                      onClick={() => setPickerOpen(true)}
                    >
                      Change
                    </button>
                  </div>
                  <div className="mt-1 flex justify-between text-xs text-muted">
                    <span>Balance {money(customer.balance, currency)}</span>
                    <span>
                      Limit{" "}
                      {customer.credit_limit > 0
                        ? money(customer.credit_limit, currency)
                        : "—"}
                    </span>
                  </div>
                </div>
              ) : (
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => setPickerOpen(true)}
                >
                  <UserPlus className="size-4" /> Select customer
                </Button>
              )}

              {wouldExceed ? (
                <div className="rounded-md border border-danger/40 bg-danger/10 p-3 text-xs">
                  <p className="flex items-center gap-1.5 font-medium text-danger">
                    <ShieldAlert className="size-4" /> Over credit limit
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    New balance would be {money(projectedBalance, currency)}.
                  </p>
                  {can("manager") ? (
                    <label className="mt-2 flex items-center gap-2 text-foreground">
                      <input
                        type="checkbox"
                        checked={override}
                        onChange={(e) => setOverride(e.target.checked)}
                      />
                      Authorize override
                    </label>
                  ) : (
                    <>
                      {approvalToken && (
                        <p className="mt-2 text-success">
                          Approved for this amount. Approval expires after two
                          minutes.
                        </p>
                      )}
                      <OverrideApproval
                        key={approvalKey}
                        customerId={customer!.customer_id}
                        amount={total}
                        onApproved={(token) =>
                          setApproval({ key: approvalKey, token })
                        }
                      />
                    </>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="border-t border-border pt-3">
            <div className="flex items-end justify-between">
              <span className="text-sm text-muted">Total</span>
              <span className="text-2xl font-semibold tabular-nums">
                {money(total, currency)}
              </span>
            </div>
          </div>

          {!online ? (
            <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-center text-xs text-warning">
              Offline — cash sales are saved and synced automatically. Card/EFT
              and credit need a connection.
            </p>
          ) : null}

          <Button
            className="w-full"
            size="lg"
            loading={busy}
            disabled={
              !payment.valid ||
              lines.length === 0 ||
              (!online && saleType !== "CASH")
            }
            onClick={complete}
          >
            {!online && saleType === "CASH"
              ? "Save cash sale offline"
              : saleType === "CASH"
                ? "Complete cash sale"
                : saleType === "CREDIT"
                  ? "Complete credit sale"
                  : "Complete paid sale"}
          </Button>
        </div>
      </fieldset>
      <ReceiptHistory refreshKey={savedSale} />
      <ProductSearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onPick={addProduct}
      />
      <CustomerPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={(c) => {
          setCustomer(c);
          setOverride(false);
        }}
      />
      <ProductRegisterDialog
        open={registerOpen}
        onOpenChange={setRegisterOpen}
        initialBarcode={unknownCode}
        onCreated={(p) => addProduct(p)}
      />
    </div>
  );
}
