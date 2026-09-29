"use client";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store-context";
import { useOffline } from "@/lib/offline/offline-context";
import type { Tables } from "@/lib/db/database.types";
const fields = [
  ["name", "Customer name"],
  ["phone", "Phone"],
  ["email", "Email address"],
  ["street", "Street name"],
  ["suburb", "Suburb"],
  ["town", "Town"],
  ["province", "Province"],
  ["postal_code", "Postal code"],
  ["country", "Country"],
] as const;
export function CustomerProfile({
  customer,
}: {
  customer: Tables<"customers">;
}) {
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState(customer),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false),
    router = useRouter(),
    cache = useQueryClient();
  const { can } = useStore();
  const { online } = useOffline();
  return (
    <>
      <Button
        disabled={!online}
        onClick={() => {
          setDraft(customer);
          setError("");
          setOpen(true);
        }}
      >
        Edit Customer Profile
      </Button>
      <Dialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogTitle>Edit Customer Profile</DialogTitle>
          <DialogDescription>
            Update contact details. Existing invoices and balances keep their
            recorded values.
          </DialogDescription>
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (lock.current || !online) return;
              lock.current = true;
              setBusy(true);
              setError("");
              try {
                const { error } = await createClient().rpc(
                  "update_customer_profile",
                  {
                    p_customer: customer.id,
                    p_expected: customer.updated_at,
                    p_details: Object.fromEntries([
                      ...fields.map(([key]) => [key, draft[key] ?? ""]),
                      ["customer_type", draft.customer_type],
                      ["credit_enabled", draft.credit_enabled],
                      ["auto_email_invoices", !!draft.auto_email_invoices],
                      ["email_notifications", !!draft.email_notifications],
                    ]),
                  },
                );
                if (error) throw error;
                await cache.invalidateQueries({
                  queryKey: ["customer-picker"],
                });
                setOpen(false);
                router.refresh();
              } catch (e) {
                setError(
                  (e as Error).message.includes("CUSTOMER_CHANGED")
                    ? "This customer was updated elsewhere. Refresh the page before editing again."
                    : "Could not save. Check the details and your access, then retry.",
                );
              } finally {
                setBusy(false);
                lock.current = false;
              }
            }}
          >
            <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
              {fields.map(([key, label]) => (
                <label key={key} className="text-sm">
                  {label}
                  <Input
                    required={key === "name"}
                    type={key === "email" ? "email" : "text"}
                    maxLength={
                      key === "email"
                        ? 254
                        : key === "phone"
                          ? 50
                          : key === "postal_code"
                            ? 30
                            : 200
                    }
                    value={draft[key] ?? ""}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        [key]: e.target.value,
                        ...(key === "email" && !e.target.value.trim()
                          ? {
                              auto_email_invoices: false,
                              email_notifications: false,
                            }
                          : {}),
                      })
                    }
                  />
                </label>
              ))}
              <label className="text-sm">
                Customer type
                <select
                  className="h-10 w-full rounded border border-border bg-input px-3"
                  value={draft.customer_type}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      customer_type: e.target.value as
                        | "INDIVIDUAL"
                        | "BUSINESS",
                    })
                  }
                >
                  <option value="INDIVIDUAL">Individual</option>
                  <option value="BUSINESS">Business</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.credit_enabled}
                  disabled={!can("manager")}
                  onChange={(e) =>
                    setDraft({ ...draft, credit_enabled: e.target.checked })
                  }
                />
                Allow credit purchases
              </label>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  checked={!!draft.email_notifications}
                  disabled={!draft.email?.trim()}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      email_notifications: e.target.checked,
                      auto_email_invoices: false,
                    })
                  }
                />
                Email Notifications � all customer documents
              </label>
              <p className="text-xs text-muted sm:col-span-2">
                Automatically email completed transactions and their documents
                to this address. Includes invoices, orders, receipts, payments,
                returns and delivery updates. Applies to future transactions
                only.
              </p>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  checked={!!draft.auto_email_invoices}
                  disabled={!draft.email?.trim() || draft.email_notifications}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      auto_email_invoices: e.target.checked,
                    })
                  }
                />
                Invoices only (legacy preference)
              </label>
              <p className="text-xs text-muted sm:col-span-2">
                Requires a valid email address. Applies to future issued
                invoices; drafts and existing invoices are not sent.
              </p>
            </fieldset>
            {customer.address && !customer.street && (
              <p className="text-xs text-muted">
                Existing address: {customer.address}. This is retained until a
                structured address is entered.
              </p>
            )}
            <p className="text-xs text-muted">
              Only managers and owners can change credit eligibility. Existing
              debt remains payable when credit is disabled.
            </p>
            {error && (
              <p role="alert" className="text-danger">
                {error}
              </p>
            )}
            <Button type="submit" loading={busy} disabled={!online}>
              Save customer details
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
