import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { DocumentLogo } from "@/components/document-logo";
import { DeliveryPrint } from "@/features/deliveries/delivery-print";
import { dateOnly, dateTime } from "@/lib/format";
import { statusLabel } from "@/features/billing/status-label";
import type { DeliveryDetail } from "@/features/deliveries/types";
export default async function DeliveryNote({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const session = await getSession("orders_deliveries");
  if (!session?.activeStore) notFound();
  const { orderId } = await params;
  const { data, error } = await (
    await createClient()
  ).rpc("delivery_detail", { p_order: orderId });
  if (error) throw error;
  const detail = data as unknown as DeliveryDetail,
    d = detail.delivery;
  if (!d || d.store_id !== session.activeStore.id) notFound();
  const s = d.snapshot;
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-3 print:hidden">
        <Link href={`/orders/deliveries/${orderId}`} className="underline">
          Back to delivery
        </Link>
        <DeliveryPrint />
      </div>
      <article
        id="receipt"
        className="mx-auto max-w-4xl space-y-5 rounded-lg bg-white p-6 text-black"
      >
        <style>{`@media print { @page { size: A4; margin: 10mm; } #receipt { position: static; padding: 0; } #receipt thead { display: table-header-group; } #receipt tr, #receipt .signatures { break-inside: avoid; } }`}</style>
        <header className="space-y-2">
          <DocumentLogo businessId={d.business_id} />
          <h1 className="text-2xl font-bold">{s.business_name}</h1>
          <p className="whitespace-pre-wrap">
            {s.business_address || "Business address not configured"}
          </p>
          <p>
            {s.business_phone || "Business contact not configured"}{" "}
            {s.business_email}
          </p>
          <h2 className="text-xl font-semibold">
            Delivery Note — {statusLabel(d.status)}
          </h2>
          <p className="break-all">{d.reference}</p>
        </header>
        {d.status === "CANCELLED" && (
          <p className="border-2 border-black p-3 font-bold">
            CANCELLED — DO NOT DELIVER. {d.cancellation_reason} ·{" "}
            {dateTime(d.cancelled_at!)}
          </p>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <p>Order: {s.order_reference}</p>
          <p>Invoice: {s.invoice_reference}</p>
          <p>Store / branch: {s.store_name}</p>
          <p>Expected delivery: {dateOnly(d.scheduled_date)}</p>
          <p>Original delivery date: {dateOnly(d.original_date)}</p>
          <p>Note revision: {d.version}</p>
        </div>
        <section>
          <h3 className="font-semibold">Deliver to</h3>
          <p>
            {s.customer_name}
            {s.company_name && s.company_name !== s.customer_name
              ? ` · ${s.company_name}`
              : ""}
          </p>
          {s.company_name && <p>Company: {s.company_name}</p>}
          <p className="whitespace-pre-wrap">{s.delivery_address}</p>
          <p>Contact: {s.contact_number}</p>
          <p className="break-all text-xs">
            Customer / account code: {s.customer_code}
          </p>
        </section>
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col style={{ width: "40%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "30%" }} />
          </colgroup>
          <thead className="border-y border-black">
            <tr>
              {[
                "Description / SKU / Barcode",
                "Ordered",
                "To deliver",
                "Unit",
                "Remarks",
              ].map((h) => (
                <th key={h} className="break-words py-2 text-left">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {s.items.map((item) => (
              <tr key={item.id} className="border-b border-gray-300">
                <td className="break-words py-3">
                  {item.description}
                  <div className="break-all text-xs">
                    SKU: {item.sku || "—"}
                    <br />
                    Barcode: {item.barcode || "—"}
                  </div>
                </td>
                <td>{item.ordered_quantity}</td>
                <td>{item.delivery_quantity}</td>
                <td className="break-words">{item.unit}</td>
                <td className="break-words">{item.remarks || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <section className="space-y-2">
          <h3 className="font-semibold">Driver details</h3>
          <p>Driver: {d.driver_name || "________________________"}</p>
          <p>
            Vehicle registration:{" "}
            {d.vehicle_registration || "________________________"}
          </p>
          <p>
            Delivery reference:{" "}
            {d.delivery_reference || "________________________"}
          </p>
          <p className="whitespace-pre-wrap">
            Instructions / comments:{" "}
            {d.comments || "________________________________________"}
          </p>
        </section>
        <section className="signatures space-y-5">
          <h3 className="font-semibold">Delivery confirmation</h3>
          <p>
            Delivered date / time:{" "}
            {d.delivered_at
              ? dateTime(d.delivered_at)
              : "________________________"}
          </p>
          <p>Received by: {d.received_by || "________________________"}</p>
          <p>
            Receiver contact: {d.receiver_phone || "________________________"}
          </p>
          <p>Receiver signature: ___________________________________</p>
          <p>Driver signature: ____________________________________</p>
          <p>Delivery comments: __________________________________</p>
          <p>___________________________________________________</p>
        </section>
        <p className="text-xs">
          Driver copy · This note is not a tax invoice. Confirm delivery in POS
          INVENTORY after the recipient accepts all listed items.
        </p>
      </article>
    </>
  );
}
