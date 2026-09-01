"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { HandCoins, SlidersHorizontal } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store-context";
import { money, friendlyError } from "@/lib/format";

export function CreditActions({
  customerId, balance, creditLimit,
}: {
  customerId: string;
  balance: number;
  creditLimit: number;
}) {
  const router = useRouter();
  const { currency, can } = useStore();
  const [payOpen, setPayOpen] = React.useState(false);
  const [limitOpen, setLimitOpen] = React.useState(false);
  const [amount, setAmount] = React.useState("");
  const [limit, setLimit] = React.useState(String(creditLimit || ""));
  const [busy, setBusy] = React.useState(false);

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(amount);
    if (!amt || amt <= 0) { toast.error("Enter a valid amount"); return; }
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("record_credit_payment", { p_customer: customerId, p_amount: amt });
    setBusy(false);
    if (error) { toast.error(friendlyError(error.message)); return; }
    toast.success(`Payment of ${money(amt, currency)} recorded`);
    setPayOpen(false); setAmount("");
    router.refresh();
  }

  async function saveLimit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("set_credit_limit", { p_customer: customerId, p_limit: Number(limit) || 0 });
    setBusy(false);
    if (error) { toast.error(friendlyError(error.message)); return; }
    toast.success("Credit limit updated");
    setLimitOpen(false);
    router.refresh();
  }

  return (
    <div className="flex gap-2">
      <Button onClick={() => setPayOpen(true)}><HandCoins className="size-4" /> Record payment</Button>
      {can("manager") ? (
        <Button variant="secondary" onClick={() => setLimitOpen(true)}><SlidersHorizontal className="size-4" /> Set limit</Button>
      ) : null}

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Record payment</DialogTitle>
            <DialogDescription>Current balance: {money(balance, currency)}. Payments do not affect stock.</DialogDescription>
          </DialogHeader>
          <form onSubmit={pay} className="space-y-4">
            <div>
              <Label htmlFor="amt">Amount received</Label>
              <Input id="amt" type="number" step="0.01" min="0" autoFocus value={amount}
                onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
              <div className="mt-2 flex gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setAmount(String(balance))}>Pay full ({money(balance, currency)})</Button>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setPayOpen(false)}>Cancel</Button>
              <Button type="submit" loading={busy}>Record payment</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={limitOpen} onOpenChange={setLimitOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Set credit limit</DialogTitle></DialogHeader>
          <form onSubmit={saveLimit} className="space-y-4">
            <div>
              <Label htmlFor="lim">Credit limit (0 = no limit enforced)</Label>
              <Input id="lim" type="number" step="0.01" min="0" autoFocus value={limit}
                onChange={(e) => setLimit(e.target.value)} placeholder="0.00" />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setLimitOpen(false)}>Cancel</Button>
              <Button type="submit" loading={busy}>Save limit</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
