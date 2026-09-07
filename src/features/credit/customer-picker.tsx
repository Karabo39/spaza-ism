"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { toast } from "sonner";
import { Search, UserPlus, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store-context";
import { money, friendlyError } from "@/lib/format";
import type { CreditCustomer } from "@/lib/db/database.types";

function CustomerPickerContent({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSelect: (c: CreditCustomer) => void;
}) {
  const { store, currency } = useStore();
  const [q, setQ] = React.useState("");
  const term = useDebouncedValue(q.trim());
  const [creating, setCreating] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [newPhone, setNewPhone] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const search = useQuery({
    queryKey: ["customer-picker", store.id, term],
    enabled: !creating,
    staleTime: 0,
    queryFn: async () => {
      let query = createClient()
        .from("v_credit_customers")
        .select("*")
        .eq("store_id", store.id)
        .eq("is_active", true);
      if (term) query = query.ilike("name", `%${term}%`);
      const { data, error } = await query.order("name").limit(30);
      if (error) throw error;
      return (data ?? []) as CreditCustomer[];
    },
  });
  const waiting = q.trim() !== term || search.isLoading;
  const rows = waiting ? [] : (search.data ?? []);

  async function createCustomer(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("customers")
      .insert({
        business_id: store.businessId,
        store_id: store.id,
        name: newName.trim(),
        phone: newPhone.trim() || null,
      })
      .select("id")
      .single();
    if (error || !data) {
      setBusy(false);
      toast.error(friendlyError(error?.message));
      return;
    }
    // credit_account is auto-created by trigger; read the view row
    const { data: cc } = await supabase
      .from("v_credit_customers")
      .select("*")
      .eq("customer_id", data.id)
      .maybeSingle();
    setBusy(false);
    toast.success("Customer added");
    if (cc) {
      onSelect(cc as CreditCustomer);
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {creating ? "New customer" : "Select customer"}
          </DialogTitle>
        </DialogHeader>

        {creating ? (
          <form onSubmit={createCustomer} className="space-y-4">
            <div>
              <Label htmlFor="c-name">Name</Label>
              <Input
                id="c-name"
                required
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Customer name"
              />
            </div>
            <div>
              <Label htmlFor="c-phone">Phone (optional)</Label>
              <Input
                id="c-phone"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="072 000 0000"
              />
            </div>
            <div className="flex justify-between gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setCreating(false)}
              >
                Back
              </Button>
              <Button type="submit" loading={busy}>
                Create &amp; select
              </Button>
            </div>
          </form>
        ) : (
          <>
            <div className="flex items-center gap-2 rounded-md border border-border bg-input px-3">
              <Search className="size-4 text-muted" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                autoFocus
                placeholder="Search customers…"
                className="h-11 min-w-0 flex-1 bg-transparent text-sm focus:outline-none"
              />
            </div>
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {search.isError ? (
                <p role="alert" className="p-4 text-sm text-danger">
                  Couldn&apos;t load customers.{" "}
                  <Button variant="ghost" onClick={() => search.refetch()}>
                    Retry
                  </Button>
                </p>
              ) : waiting ? (
                <p role="status" className="p-4 text-sm text-muted">
                  Searching...
                </p>
              ) : rows.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted">
                  No customers found.
                </p>
              ) : (
                rows.map((c) => (
                  <button
                    key={c.customer_id}
                    onClick={() => {
                      onSelect(c);
                      onOpenChange(false);
                    }}
                    className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left hover:bg-surface-2"
                  >
                    <div className="min-w-0 flex-1 break-words">
                      <p className="text-sm font-medium">{c.name}</p>
                      <p className="text-xs text-muted">
                        {c.phone ?? "No phone"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p
                        className={`text-sm tabular-nums ${c.balance > 0 ? "text-warning" : "text-muted-foreground"}`}
                      >
                        {money(c.balance, currency)}
                      </p>
                      <p className="text-[10px] text-muted">
                        {c.over_limit
                          ? "Over limit"
                          : `Avail ${money(c.available_credit, currency)}`}
                      </p>
                    </div>
                    <Check className="size-4 text-muted opacity-0" />
                  </button>
                ))
              )}
            </div>
            <Button
              variant="secondary"
              onClick={() => setCreating(true)}
              className="w-full"
            >
              <UserPlus className="size-4" /> New customer
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function CustomerPicker(
  props: React.ComponentProps<typeof CustomerPickerContent>,
) {
  const { store } = useStore();
  return props.open ? (
    <CustomerPickerContent key={store.id} {...props} />
  ) : null;
}
