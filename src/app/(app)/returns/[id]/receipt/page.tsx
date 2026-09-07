import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { PrintReceipt } from "@/features/billing/print-receipt";
import { money, dateTime, dateOnly } from "@/lib/format";

export default async function ReturnReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession("returns");
  if (!session?.activeStore) redirect("/onboarding");
  const store = session.activeStore;
  const db = await createClient();
  const { data: r, error } = await db
    .from("goods_returns")
    .select("*")
    .eq("id", id)
    .eq("store_id", store.id)
    .eq("status", "APPROVED")
    .maybeSingle();
  if (error) throw error;
  if (!r) notFound();
  const [lines, refunds, invoice, credit, allocations, customer, approver] =
    await Promise.all([
      db
        .from("goods_return_items")
        .select("*")
        .eq("return_id", id)
        .order("product_name"),
      db
        .from("customer_refunds")
        .select("*")
        .eq("return_id", id)
        .order("created_at"),
      r.invoice_id
        ? db
            .from("sales_invoices")
            .select("*")
            .eq("id", r.invoice_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      r.credit_entry_id
        ? db
            .from("invoice_entries")
            .select("reference")
            .eq("id", r.credit_entry_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      db.from("store_credit_allocations").select("amount").eq("return_id", id),
      r.customer_id
        ? db
            .from("customers")
            .select("name")
            .eq("id", r.customer_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      r.approved_by
        ? db
            .from("profiles")
            .select("full_name")
            .eq("id", r.approved_by)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
  for (const result of [
    lines,
    refunds,
    invoice,
    credit,
    allocations,
    customer,
    approver,
  ])
    if (result.error) throw result.error;
  const refunded = (refunds.data ?? []).reduce(
    (sum, f) => sum + Number(f.amount),
    0,
  );
  const allocated = (allocations.data ?? []).reduce(
    (sum, a) => sum + Number(a.amount),
    0,
  );
  const currency = invoice.data?.currency ?? store.currency;
  return (
    <>
      <div className="mb-4 flex justify-between print:hidden">
        <Link href="/returns" className="text-accent">
          Back to returns
        </Link>
        <PrintReceipt />
      </div>
      <article
        id="receipt"
        className="mx-auto max-w-3xl space-y-5 rounded-lg bg-white p-8 text-black"
      >
        <header className="flex flex-wrap justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">
              {invoice.data?.business_name ?? store.businessName}
            </h1>
            <p>{invoice.data?.store_name ?? store.name}</p>
          </div>
          <div>
            <h2 className="text-xl font-semibold">
              Credit note / return receipt
            </h2>
            <p className="break-all text-xs">
              {credit.data?.reference ?? r.reference}
            </p>
          </div>
        </header>
        <div className="space-y-2 text-sm">
          <p className="break-all">Return: {r.reference}</p>
          <p className="break-all">
            Original {r.invoice_id ? "invoice" : "sale"}:{" "}
            {invoice.data?.reference ?? r.sale_id}
          </p>
          <p>
            Customer:{" "}
            {invoice.data?.customer_name ??
              customer.data?.name ??
              "Walk-in customer"}
          </p>
          <p>
            Approved: {dateTime(r.processed_at)} ·{" "}
            {approver.data?.full_name ?? "Recorded staff member"}
          </p>
          <p>Reason: {r.reason}</p>
          <p>Inspection: {r.inspection}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-black">
              <tr>
                <th className="py-2 text-left">Returned item</th>
                <th>Qty</th>
                <th className="text-left">Condition / action</th>
                <th className="text-right">Credit</th>
              </tr>
            </thead>
            <tbody>
              {lines.data?.map((l) => (
                <tr key={l.id} className="border-b border-gray-200">
                  <td className="py-3">
                    {l.product_name}
                    {l.expiry_date && (
                      <p className="text-xs">
                        Expiry: {dateOnly(l.expiry_date)}
                      </p>
                    )}
                  </td>
                  <td className="px-2 text-center">{l.quantity}</td>
                  <td className="text-xs">
                    {l.condition} · {l.inventory_action.replaceAll("_", " ")}
                  </td>
                  <td className="text-right">{money(l.amount, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="space-y-1 text-right">
          <p className="text-xl font-bold">
            Approved credit: {money(r.amount, currency)}
          </p>
          <p>Refunds paid: {money(refunded, currency)}</p>
          <p>Credit applied to other invoices: {money(allocated, currency)}</p>
        </div>
        <p className="text-xs">
          This credit reduces the original amount owed. Refund availability also
          depends on the customer’s account balance and any credit already used.
        </p>
        <section>
          <h3 className="font-semibold">Refund history</h3>
          {refunds.data?.length ? (
            refunds.data.map((f) => (
              <div key={f.id} className="border-b border-gray-200 py-2 text-xs">
                <p>
                  {dateTime(f.created_at)} · {money(f.amount, currency)} ·{" "}
                  {f.method.replaceAll("_", "/")}
                </p>
                <p className="break-all">
                  {f.reference} {f.payment_reference}
                </p>
              </div>
            ))
          ) : (
            <p className="text-sm">No refund paid against this return.</p>
          )}
        </section>
        <p className="text-xs">
          Keep this document with the original proof of purchase.
        </p>
      </article>
    </>
  );
}
