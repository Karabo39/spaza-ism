import { receiptCustomer } from "@/features/goods-out/receipt-customer";
import type { Database } from "@/lib/db/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dateTime, dateOnly } from "@/lib/format";
import type { ExportData } from "@/features/reports/export-data";
import type { CustomerDocument } from "../../../supabase/functions/_shared/customer-document";
export async function loadEmailDocument(
  db: SupabaseClient<Database>,
  type: "invoice" | "return" | "sale",
  id: string,
  storeId: string,
  storeName: string,
  businessName: string,
  currency: string,
): Promise<{
  recipient: string;
  reference: string;
  data: ExportData;
  email: CustomerDocument;
} | null> {
  const columns = [
    { key: "description", label: "Description" },
    { key: "quantity", label: "Quantity" },
    { key: "unit", label: "Unit price" },
    { key: "amount", label: "Amount" },
  ];
  if (type === "sale") {
    const { data, error } = await db
      .from("sale_receipts")
      .select("snapshot")
      .eq("sale_id", id)
      .eq("store_id", storeId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const r =
      data.snapshot as import("@/features/goods-out/payments").SaleReceipt;
    const customerName = await receiptCustomer(db, r, storeId);
    const m = (value: number) => documentMoney(value, r.currency);
    return {
      recipient: "",
      reference: r.reference,
      email: {
        type: "Sales receipt",
        customer: customerName || "Customer",
        business: r.business,
        store: r.store,
        reference: r.reference,
        date: r.created_at,
        currency: r.currency,
        summary: "Sale completed",
        total: r.total,
        payment_status: r.status,
        outstanding: r.status === "CREDIT" ? r.total : 0,
        lines: r.items.map((l) => ({
          description: l.name,
          quantity: l.quantity,
          price: l.unit_price,
          amount: l.total,
        })),
      },
      data: {
        title: `Sales receipt ${r.reference}`,
        subtitle: `${r.business} · ${r.store} · ${dateTime(r.created_at)}
Cashier: ${r.cashier} · Till: ${r.till || "Not recorded"} · ${r.status}
${r.status === "CREDIT" ? `Customer: ${customerName || "Not recorded"}` : ""}
Transaction: ${r.id}`,
        columns,
        rows: [
          ...r.items.map((i) => ({
            description: i.name,
            quantity: i.quantity,
            unit: m(i.unit_price),
            amount: m(i.total),
          })),
          { description: "Discount", amount: m(r.discount) },
          { description: "VAT: not separately calculated" },
          { description: "Total", amount: m(r.total) },
          ...r.payments.map((p) => ({
            description: `${p.method.replace("_", " / ")} ${p.reference ?? ""}`,
            amount: m(p.amount),
          })),
          { description: "Cash received", amount: m(r.cash_tendered) },
          { description: "Change", amount: m(r.change) },
        ],
      },
    };
  }
  if (type === "invoice") {
    const { data: i, error } = await db
      .from("v_invoice_balances")
      .select("*")
      .eq("id", id)
      .eq("store_id", storeId)
      .maybeSingle();
    if (error) throw error;
    if (!i) return null;
    const [lines, entries, contact] = await Promise.all([
      db
        .from("sales_invoice_items")
        .select("*")
        .eq("invoice_id", id)
        .order("product_name"),
      db
        .from("invoice_entries")
        .select("*")
        .eq("invoice_id", id)
        .order("created_at"),
      db
        .from("customers")
        .select("email")
        .eq("id", i.customer_id)
        .maybeSingle(),
    ]);
    if (lines.error || entries.error || contact.error)
      throw lines.error ?? entries.error ?? contact.error;
    const m = (n: number) => documentMoney(n, i.currency);
    const rows: Record<string, unknown>[] = (lines.data ?? []).map((l) => ({
      description: l.product_name,
      quantity: l.quantity,
      unit: m(l.unit_price),
      amount: m(l.line_total),
    }));
    for (const [description, amount] of [
      ["Subtotal", i.subtotal],
      ["Discount", i.discount],
      [`Tax (${i.tax_percent}%)`, i.tax_amount],
      ["Invoice total", i.total],
      ["Debit notes", i.debits],
      ["Credit notes", i.credits],
      ["Received", i.paid],
      ["Outstanding", i.outstanding],
    ] as [string, number][])
      rows.push({ description, amount: m(amount) });
    for (const e of entries.data ?? [])
      if (e.kind !== "ISSUE")
        rows.push({
          description: `${dateTime(e.created_at)} ${e.reference} ${e.kind} ${e.method ?? ""} ${e.payment_reference ?? ""} ${e.reason ?? ""}`,
          amount: m(e.amount),
        });
    if (i.revision)
      rows.push({
        description: `Revision ${i.revision}: updated items and totals`,
      });
    if (i.note) rows.push({ description: i.note });
    return {
      recipient:
        (i.customer_snapshot as { email?: string } | null)?.email ??
        contact.data?.email ??
        "",
      reference: i.reference,
      email: {
        type: i.state === "DRAFT" ? "Draft invoice" : "Invoice",
        customer: i.customer_name,
        business: i.business_name,
        store: i.store_name,
        reference: i.reference,
        date: i.invoice_date || i.created_at,
        due: i.due_date,
        currency: i.currency,
        summary: i.note || "Customer invoice",
        total: i.total,
        payment_status: i.status,
        outstanding: i.outstanding,
        lines: (lines.data ?? []).map((l) => ({
          description: l.product_name,
          quantity: l.quantity,
          price: l.unit_price,
          amount: l.line_total,
        })),
      },
      data: {
        title: `${i.state === "DRAFT" ? "Draft invoice" : "Invoice / receipt"} ${i.reference}`,
        subtitle: `${i.business_name} · ${i.store_name}
Customer: ${i.customer_name}
Address: ${(i.customer_snapshot as { address?: string } | null)?.address || "Not recorded"}
Invoice date: ${dateOnly(i.invoice_date || i.created_at)} · ${i.currency} · Due ${dateOnly(i.due_date)} · ${i.status}
Ordered By: ${i.ordered_by_name || "Not recorded"} · Invoiced By: ${i.invoiced_by_name || "Not recorded"}
Salesperson: ${i.salesperson} · Goods: ${i.goods_issued_at ? dateTime(i.goods_issued_at) : "Awaiting delivery"}`,
        columns,
        rows,
      },
    };
  }
  const { data: r, error } = await db
    .from("goods_returns")
    .select("*")
    .eq("id", id)
    .eq("store_id", storeId)
    .eq("status", "APPROVED")
    .maybeSingle();
  if (error) throw error;
  if (!r) return null;
  const [lines, refunds, allocations, contact, invoice] = await Promise.all([
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
    db.from("store_credit_allocations").select("amount").eq("return_id", id),
    r.customer_id
      ? db
          .from("customers")
          .select("name,email")
          .eq("id", r.customer_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    r.invoice_id
      ? db
          .from("sales_invoices")
          .select("currency,reference")
          .eq("id", r.invoice_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  for (const result of [lines, refunds, allocations, contact, invoice])
    if (result.error) throw result.error;
  const m = (n: number) => documentMoney(n, invoice.data?.currency ?? currency);
  const rows: Record<string, unknown>[] = (lines.data ?? []).map((l) => ({
    description: `${l.product_name} · ${l.condition} · ${l.inventory_action}${l.expiry_date ? ` · Expiry ${dateOnly(l.expiry_date)}` : ""}`,
    quantity: l.quantity,
    amount: m(l.amount),
  }));
  rows.push(
    { description: "Approved credit", amount: m(r.amount) },
    {
      description: "Refunds paid",
      amount: m((refunds.data ?? []).reduce((n, f) => n + Number(f.amount), 0)),
    },
    {
      description: "Credit applied to invoices",
      amount: m(
        (allocations.data ?? []).reduce((n, f) => n + Number(f.amount), 0),
      ),
    },
  );
  for (const f of refunds.data ?? [])
    rows.push({
      description: `Refund ${dateTime(f.created_at)} · ${f.method} · ${f.reason}`,
      amount: m(f.amount),
    });
  rows.push({
    description: `Reason: ${r.reason}
Inspection: ${r.inspection}`,
  });
  return {
    recipient: contact.data?.email ?? "",
    reference: r.reference,
    email: {
      type: "Return / credit note",
      customer: contact.data?.name || "Customer",
      business: businessName,
      store: storeName,
      reference: r.reference,
      related_reference: invoice.data?.reference,
      date: r.processed_at || r.created_at,
      currency: invoice.data?.currency ?? currency,
      summary: r.reason,
      total: r.amount,
      payment_status: "Credit approved",
      lines: (lines.data ?? []).map((l) => ({
        description: l.product_name,
        quantity: l.quantity,
        amount: l.amount,
      })),
    },
    data: {
      title: `Credit note / return receipt ${r.reference}`,
      subtitle: `${businessName} · ${storeName}
Customer: ${contact.data?.name ?? "Walk-in customer"} · Original: ${invoice.data?.reference ?? r.sale_id ?? ""}
Approved: ${dateTime(r.processed_at)}`,
      columns,
      rows,
    },
  };
}

// ISO codes remain unambiguous and printable for every supported currency.
function documentMoney(value: number, currency: string) {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency,
    currencyDisplay: "code",
    minimumFractionDigits: 2,
  })
    .format(value)
    .replace(/\s/g, " ");
}
