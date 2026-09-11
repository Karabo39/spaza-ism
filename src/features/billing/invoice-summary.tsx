import { Button } from "@/components/ui/button";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/format";
import type { ModulePermissions, ModuleKey } from "@/lib/modules";
export async function InvoiceSummary({
  storeId,
  currency,
  permissions,
  canOpen = true,
}: {
  storeId: string;
  currency: string;
  permissions: ModulePermissions;
  canOpen?: boolean;
}) {
  if (!permissions.invoices_summary) return null;
  const db = await createClient();
  const { data, error } = await db.rpc("invoice_summary", { p_store: storeId });
  if (error) throw error;
  const values = (data ?? {}) as Record<string, number>;
  const cards = [
    ["invoiced", "Invoiced"],
    ["paid", "Paid / allocated"],
    ["outstanding", "Outstanding"],
    ["overdue", "Overdue"],
    ["credit_notes", "Credit notes"],
    ["month_to_date", "Invoiced this month"],
  ].filter(
    ([key]) =>
      permissions[("invoices_" + key) as ModuleKey] &&
      Object.hasOwn(values, key),
  );
  return (
    <section className="mb-6">
      <div className="mb-3 flex justify-between">
        <h2 className="font-semibold">Invoicing</h2>
        {canOpen && permissions.invoices_view_invoices && (
          <Button asChild>
            <Link href="/invoices">View invoices</Link>
          </Button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map(([key, label]) => (
          <div
            key={key}
            className="rounded-lg border border-border bg-surface p-3"
          >
            <p className="text-xs text-muted">{label}</p>
            <p className="mt-1 font-semibold tabular-nums">
              {money(values[key], currency)}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
