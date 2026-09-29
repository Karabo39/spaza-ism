"use client";
import { DeliveryStatus } from "./delivery-status";
/* eslint-disable @next/next/no-img-element -- Inline report logo must print without a remote image proxy. */
import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useStore } from "@/lib/store-context";
import { createClient } from "@/lib/supabase/client";
import { loadDocumentLogo } from "@/lib/document-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DELIVERY_STATUSES,
  collectDeliveryReport,
  describeFilters,
  exportRow,
  displayReportValue,
  reportArgs,
  reportColumns,
  summaryLabels,
  type DeliveryReportPage,
  type ReportFilters,
  type ReportMode,
} from "./report-data";
import type { DeliveryExport } from "./report-export";
export function DeliveryReport() {
  const { store } = useStore();
  return <Report key={store.id} />;
}
function Report() {
  const { store, stores } = useStore();
  const eligible = stores.filter(
    (s) =>
      s.businessId === store.businessId &&
      s.locationType === "store" &&
      s.modules.reports_delivery,
  );
  const [branch, setBranch] = useState(store.id),
    [draft, setDraft] = useState<ReportFilters>({ date_field: "delivery" }),
    [applied, setApplied] = useState({
      branch: store.id,
      filters: { date_field: "delivery" } as ReportFilters,
    }),
    [cursors, setCursors] = useState<(number | null)[]>([null]),
    [busy, setBusy] = useState(false),
    [printed, setPrinted] = useState<DeliveryExport | null>(null);
  const exportLock = useRef(false);
  const selected = eligible.filter(
      (s) => applied.branch === "all" || s.id === applied.branch,
    ),
    ids = selected.map((s) => s.id),
    cursor = cursors.at(-1) ?? null;
  async function fetchPage(
    mode: ReportMode,
    after: number | null = null,
    until: number | null = null,
  ) {
    const { data, error } = await createClient().rpc(
      "delivery_report",
      reportArgs(ids, applied.filters, mode, after, until),
    );
    if (error)
      throw Error(
        error.message.includes("FORBIDDEN")
          ? "Report permission has changed. Refresh and review the selected stores."
          : error.message,
      );
    return data as unknown as DeliveryReportPage;
  }
  const first = useQuery({
    queryKey: ["billing", "delivery-report", ids, applied.filters],
    enabled: ids.length > 0,
    queryFn: () => fetchPage("view"),
  });
  const later = useQuery({
    queryKey: [
      "billing",
      "delivery-report",
      ids,
      applied.filters,
      cursor,
      first.data?.until,
    ],
    enabled: cursor !== null && !!first.data && ids.length > 0,
    queryFn: () => fetchPage("view", cursor, first.data!.until),
  });
  const query = cursor === null ? first : later,
    rows = query.data?.rows ?? [],
    summary = first.data?.summary;
  const permitted = (mode: "print" | "xlsx" | "pdf") =>
    selected.length > 0 &&
    selected.every(
      (s) =>
        s.modules[
          mode === "print"
            ? "reports_delivery_print"
            : mode === "xlsx"
              ? "reports_delivery_excel"
              : "reports_delivery_pdf"
        ],
    );
  async function output(mode: "print" | "xlsx" | "pdf") {
    if (exportLock.current) return;
    exportLock.current = true;
    setBusy(true);
    try {
      const result = await collectDeliveryReport((after, until) =>
        fetchPage(mode, after, until),
      );
      const payload: DeliveryExport = {
        ...result,
        business: store.businessName,
        filters: describeFilters(
          applied.filters,
          selected.map((s) => s.name),
        ),
        logo: await loadDocumentLogo(createClient(), store.businessId),
      };
      if (mode === "print") {
        flushSync(() => setPrinted(payload));
        await Promise.all(
          Array.from(
            document.querySelectorAll<HTMLImageElement>("#receipt img"),
          ).map((i) => i.decode()),
        );
        await document.fonts.ready;
        window.print();
      } else {
        const { deliveryExcel, deliveryPdf } = await import("./report-export");
        const blob = await (mode === "xlsx"
          ? deliveryExcel(payload)
          : deliveryPdf(payload));
        const url = URL.createObjectURL(blob),
          a = document.createElement("a");
        a.href = url;
        a.download = `delivery-report-${new Date().toISOString().slice(0, 10)}.${mode}`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not prepare delivery report.",
      );
    } finally {
      setBusy(false);
      exportLock.current = false;
    }
  }
  const textFilters = [
    ["customer", "Customer name"],
    ["driver", "Driver name"],
    ["delivery_number", "Delivery Note Number"],
    ["order_number", "Order Number"],
    ["invoice_number", "Invoice Number"],
  ];
  return (
    <>
      <div className="space-y-5 print:hidden">
        <form
          className="rounded-lg border border-border bg-surface p-4"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied({ branch, filters: { ...draft } });
            setCursors([null]);
            setPrinted(null);
          }}
        >
          <fieldset
            disabled={busy}
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          >
            <label>
              Store / Branch
              <select
                aria-label="Store / Branch"
                className="block w-full rounded border border-border bg-input p-2"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
              >
                <option value="all">All report-enabled branches</option>
                {eligible.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Date basis
              <select
                aria-label="Date basis"
                className="block w-full rounded border border-border bg-input p-2"
                value={draft.date_field}
                onChange={(e) =>
                  setDraft({ ...draft, date_field: e.target.value })
                }
              >
                <option value="delivery">Delivery note date</option>
                <option value="order">Order date</option>
                <option value="scheduled">Scheduled delivery date</option>
                <option value="delivered">Delivered / confirmed date</option>
              </select>
            </label>
            {["from", "to"].map((key) => (
              <label key={key}>
                {key === "from" ? "From date" : "To date"}
                <Input
                  aria-label={key === "from" ? "From date" : "To date"}
                  type="date"
                  value={draft[key] ?? ""}
                  min={key === "to" ? draft.from : undefined}
                  onChange={(e) =>
                    setDraft({ ...draft, [key]: e.target.value })
                  }
                />
              </label>
            ))}
            {textFilters.map(([key, label]) => (
              <label key={key}>
                {label}
                <Input
                  aria-label={label}
                  maxLength={150}
                  value={draft[key] ?? ""}
                  onChange={(e) =>
                    setDraft({ ...draft, [key]: e.target.value })
                  }
                />
              </label>
            ))}
            <label>
              Delivery Status
              <select
                aria-label="Delivery Status"
                className="block w-full rounded border border-border bg-input p-2"
                value={draft.status ?? ""}
                onChange={(e) => setDraft({ ...draft, status: e.target.value })}
              >
                <option value="">All statuses</option>
                {Object.entries(DELIVERY_STATUSES).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Payment Status
              <select
                aria-label="Payment Status"
                className="block w-full rounded border border-border bg-input p-2"
                value={draft.payment_status ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, payment_status: e.target.value })
                }
              >
                <option value="">All payment statuses</option>
                {[
                  "PAID",
                  "PARTIALLY_PAID",
                  "UNPAID",
                  "OVERDUE",
                  "CREDITED",
                  "VOID",
                  "DRAFT",
                ].map((s) => (
                  <option key={s} value={s}>
                    {s.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end gap-2">
              <Button type="submit">View report</Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setDraft({ date_field: "delivery" });
                  setBranch(store.id);
                  setApplied({
                    branch: store.id,
                    filters: { date_field: "delivery" },
                  });
                  setCursors([null]);
                }}
              >
                Reset
              </Button>
            </div>
          </fieldset>
        </form>
        <p className="text-sm text-muted">
          {describeFilters(
            applied.filters,
            selected.map((s) => s.name),
          )}
          . Dates use each branch’s local time. Name and reference filters match
          part of the text.
        </p>
        <div className="flex flex-wrap gap-2">
          {permitted("print") && (
            <Button disabled={busy} onClick={() => output("print")}>
              Print report
            </Button>
          )}
          {permitted("xlsx") && (
            <Button disabled={busy} onClick={() => output("xlsx")}>
              Excel Export
            </Button>
          )}
          {permitted("pdf") && (
            <Button disabled={busy} onClick={() => output("pdf")}>
              PDF Export
            </Button>
          )}
          <Button
            variant="secondary"
            disabled={busy || first.isFetching}
            onClick={() => {
              setCursors([null]);
              void first.refetch();
            }}
          >
            Refresh
          </Button>
          {busy && <p role="status">Preparing all matching deliveries…</p>}
        </div>
        <p className="text-sm text-muted">
          Print and exports include all matching deliveries and totals.
          Availability depends on permissions for every selected branch. New
          deliveries appear on refresh.
        </p>
        {summary && (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {Object.entries(summaryLabels).map(([key, label]) => (
                <div key={key} className="rounded-lg border border-border p-3">
                  <p className="text-sm text-muted">{label}</p>
                  <p className="text-xl font-semibold">
                    {summary[key as keyof typeof summaryLabels]}
                  </p>
                </div>
              ))}
            </div>
            <div className="rounded border border-border p-3">
              <p className="font-semibold">Total Delivery Value</p>
              {summary.values.length ? (
                summary.values.map((v) => (
                  <p key={v.currency}>
                    {v.currency}{" "}
                    {Number(v.total).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                    })}
                  </p>
                ))
              ) : (
                <p>0.00</p>
              )}
              <p className="text-sm text-muted">
                Invoice order totals, including cancelled deliveries. This is
                not net revenue.
              </p>
            </div>
          </>
        )}
        {(query.isLoading || first.isLoading) && (
          <p role="status">Loading delivery report…</p>
        )}
        {(query.error || first.error) && (
          <p role="alert">
            Could not load the delivery report. Refresh to retry.
          </p>
        )}
        {!query.isLoading && !query.error && !rows.length && (
          <p>
            No matching deliveries. Orders appear here once a delivery note has
            been generated.
          </p>
        )}
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {[
                  "Delivery / Order / Invoice",
                  "Customer / Branch",
                  "Schedule / Status",
                  "Driver / Vehicle",
                  "Value / Payment",
                  "Attempts / Recipient",
                  "Details",
                ].map((h) => (
                  <th key={h} className="px-3 py-3 text-left whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.delivery_id}
                  className="border-t border-border align-top"
                >
                  <td className="px-3 py-3 whitespace-nowrap">
                    <p className="font-medium">{row.delivery_number}</p>
                    <p>{row.order_number}</p>
                    <p>{row.invoice_number}</p>
                  </td>
                  <td className="px-3 py-3">
                    <p>{row.customer_name}</p>
                    <p>{row.customer_contact}</p>
                    <p>{row.store_name}</p>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <DeliveryStatus status={row.delivery_status} />
                    <p>{row.scheduled_date}</p>
                  </td>
                  <td className="px-3 py-3">
                    <p>{row.driver_name || "—"}</p>
                    <p>{row.vehicle_registration || "—"}</p>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <p>
                      {row.currency} {Number(row.order_total).toFixed(2)}
                    </p>
                    <p>{row.payment_status.replaceAll("_", " ")}</p>
                  </td>
                  <td className="px-3 py-3">
                    <p>{row.attempt_count} attempt(s)</p>
                    <p>{row.received_by || "—"}</p>
                  </td>
                  <td className="px-3 py-3 min-w-64">
                    <details>
                      <summary className="cursor-pointer underline">
                        View all details
                      </summary>
                      <dl className="mt-3 space-y-2">
                        {reportColumns.map((column) => (
                          <div key={column.key}>
                            <dt className="font-medium">{column.label}</dt>
                            <dd className="whitespace-pre-wrap break-words">
                              {displayReportValue(
                                column.key,
                                exportRow(row)[column.key],
                              )}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                    {selected.find((s) => s.id === row.store_id)?.modules
                      .orders_deliveries && (
                      <Link
                        className="mt-3 block underline"
                        href={`/orders/deliveries/${row.order_id}`}
                      >
                        Manage delivery
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            disabled={cursors.length === 1 || query.isFetching || busy}
            onClick={() => setCursors(cursors.slice(0, -1))}
          >
            Previous
          </Button>
          <span>
            Page {cursors.length} · {rows.length} shown
          </span>
          <Button
            variant="secondary"
            disabled={!query.data?.next || query.isFetching || busy}
            onClick={() => setCursors([...cursors, query.data!.next])}
          >
            Next
          </Button>
        </div>
      </div>
      {printed && (
        <section
          id="receipt"
          className="hidden print:block bg-white text-black"
        >
          <style>{`@media print{@page{size:A4;margin:12mm}#receipt{position:static;padding:0;font-size:10pt}#receipt .delivery-record{break-before:page}#receipt dl>div{break-inside:avoid}}`}</style>
          {printed.logo && (
            <img
              src={printed.logo.dataUrl}
              alt="Business logo"
              style={{ maxWidth: "45mm", maxHeight: "24mm" }}
            />
          )}
          <h1 className="text-2xl font-bold">Delivery Report</h1>
          <p>{printed.business}</p>
          <p>Generated: {printed.generated_at}</p>
          <p>{printed.filters}</p>
          <dl>
            {Object.entries(summaryLabels).map(([key, label]) => (
              <div key={key}>
                {label}:{" "}
                {printed.summary?.[key as keyof typeof summaryLabels] ?? 0}
              </div>
            ))}
            {printed.summary?.values.map((v) => (
              <div key={v.currency}>
                Total Delivery Value: {v.currency} {Number(v.total).toFixed(2)}
              </div>
            ))}
          </dl>
          <p>Value includes cancelled deliveries and is not net revenue.</p>
          {printed.rows.map((row) => (
            <article key={row.delivery_id} className="delivery-record">
              <h2 className="text-xl font-bold">{row.delivery_number}</h2>
              <dl className="space-y-2">
                {reportColumns.map((c) => (
                  <div key={c.key} className="grid grid-cols-[12rem_1fr] gap-3">
                    <dt className="font-semibold">{c.label}</dt>
                    <dd className="whitespace-pre-wrap break-words">
                      {displayReportValue(c.key, exportRow(row)[c.key])}
                    </dd>
                  </div>
                ))}
              </dl>
            </article>
          ))}
        </section>
      )}
    </>
  );
}
