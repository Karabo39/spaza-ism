import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { money, dateTime } from "@/lib/format";
import { SalePrintActions } from "@/features/goods-out/sale-print-actions";
import type { SaleReceipt } from "@/features/goods-out/payments";
export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession("goods_out");
  if (!session?.activeStore) notFound();
  const { id } = await params;
  const db = await createClient();
  const { data, error } = await db
    .from("sale_receipts")
    .select("snapshot")
    .eq("sale_id", id)
    .eq("store_id", session.activeStore.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) notFound();
  const receipt = data.snapshot as SaleReceipt;
  const [prefs, events] = await Promise.all([
    db
      .from("receipt_preferences")
      .select("*")
      .eq("store_id", session.activeStore.id)
      .maybeSingle(),
    db
      .from("receipt_print_events")
      .select("action,created_at")
      .eq("sale_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  if (prefs.error || events.error) throw prefs.error ?? events.error;
  const paper = prefs.data?.paper_format ?? "80mm";
  const thermal = paper === "58mm" || paper === "80mm";
  return (
    <div className="space-y-4">
      <style>{`@media print { @page { size: ${thermal ? "auto" : "A4"}; margin: ${thermal ? "0" : "10mm"}; } #receipt { width: ${thermal ? paper : "100%"}; max-width: 100%; padding: ${thermal ? "3mm" : "0"}; font-size: ${paper === "58mm" ? "10px" : "12px"}; border-radius: 0; } #receipt table { font-size: inherit; table-layout: fixed; } #receipt td, #receipt th, #receipt p { overflow-wrap: anywhere; } #receipt h1, #receipt h2 { font-size: ${thermal ? "16px" : "24px"}; } }`}</style>
      <div className="print:hidden">
        <Link href="/goods-out" className="text-accent">
          Back to Goods Out
        </Link>
        <SalePrintActions
          id={id}
          secondCopy={prefs.data?.second_copy ?? false}
          delay={prefs.data?.delay_seconds ?? 3}
        />
      </div>
      <article
        id="receipt"
        className="mx-auto max-w-3xl space-y-5 rounded-lg bg-white p-8 text-black"
      >
        <header>
          <h1 className="text-2xl font-bold">{receipt.business}</h1>
          <p>{receipt.store}</p>
          <h2 className="text-xl">Sales receipt</h2>
          <p className="break-all text-xs">{receipt.reference}</p>
        </header>
        <div>
          <p>
            {dateTime(receipt.created_at)} · {receipt.status}
          </p>
          <p>Cashier: {receipt.cashier}</p>
          <p>Till: {receipt.till || "Not recorded"}</p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="text-left">Item</th>
              <th>Qty</th>
              <th className="text-right">Unit price</th>
              <th className="text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {receipt.items.map((item, index) => (
              <tr key={index} className="border-b">
                <td className="py-3">{item.name}</td>
                <td className="text-center">{item.quantity}</td>
                <td className="text-right">
                  {money(item.unit_price, receipt.currency)}
                </td>
                <td className="text-right">
                  {money(item.total, receipt.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="text-right">
          <p>Discount: {money(receipt.discount, receipt.currency)}</p>
          <p>
            VAT:{" "}
            {receipt.tax === null
              ? "Not separately calculated"
              : money(receipt.tax, receipt.currency)}
          </p>
          <p className="text-xl font-bold">
            Total: {money(receipt.total, receipt.currency)}
          </p>
        </div>
        <section>
          <h3 className="font-semibold">Payment details</h3>
          {receipt.payments.map((p) => (
            <p key={p.method}>
              {p.method}: {money(p.amount, receipt.currency)}{" "}
              {p.reference && `· ${p.reference}`}
            </p>
          ))}
          {receipt.status === "CREDIT" && (
            <p>Charged to the customer’s credit account.</p>
          )}
          {receipt.cash_tendered > 0 && (
            <>
              <p>
                Cash received: {money(receipt.cash_tendered, receipt.currency)}
              </p>
              <p>Change: {money(receipt.change, receipt.currency)}</p>
            </>
          )}
        </section>
        <p>
          Total paid:{" "}
          {money(
            receipt.payments.reduce((sum, p) => sum + Number(p.amount), 0),
            receipt.currency,
          )}
        </p>
        <p className="text-xs">
          Transaction: {receipt.id}. Keep this receipt for queries or returns.
        </p>
      </article>
      <details className="print:hidden">
        <summary>Print request history</summary>
        <p className="text-xs">Physical print status: unverified.</p>
        {events.data?.length ? (
          events.data.map((e, index) => (
            <p key={index} className="text-xs">
              {dateTime(e.created_at)} · {e.action.replaceAll("_", " ")}
            </p>
          ))
        ) : (
          <p className="text-xs">No print choice recorded.</p>
        )}
      </details>
    </div>
  );
}
