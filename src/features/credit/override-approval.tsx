"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store-context";
import { useOffline } from "@/lib/offline/offline-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { friendlyError } from "@/lib/format";

export function OverrideApproval({ customerId, amount, onApproved }: { customerId: string; amount: number; onApproved: (token: string) => void }) {
  const { store } = useStore();
  const { online } = useOffline();
  const [managers, setManagers] = useState<{ user_id: string; name: string }[]>([]);
  const [manager, setManager] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    createClient().rpc("credit_override_authorizers", { p_store: store.id }).then(({ data, error }) => {
      if (!active) return;
      if (error) toast.error(friendlyError(error.message));
      else setManagers(data ?? []);
    });
    return () => { active = false; };
  }, [store.id]);
  async function approve() {
    setBusy(true);
    try {
      const { data, error } = await createClient().rpc("authorize_credit_override", { p_store: store.id, p_customer: customerId, p_manager: manager, p_code: code, p_amount: amount });
      setCode("");
      const result = data as { ok?: boolean; token?: string; error?: string } | null;
      if (error || !result?.ok || !result.token) { toast.error(friendlyError(error?.message ?? result?.error)); return; }
      onApproved(result.token);
      toast.success("Manager approved. Complete the sale within two minutes.");
    } catch { toast.error("Reconnect and ask the manager to try again."); }
    finally { setBusy(false); }
  }
  return <div className="mt-3 space-y-2">
    <Label htmlFor="override-manager">Approving manager</Label>
    <select id="override-manager" className="h-10 w-full rounded-md border border-border bg-input px-2" value={manager} onChange={(e) => setManager(e.target.value)}>
      <option value="">Select manager</option>{managers.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}
    </select>
    {managers.length === 0 && <p>A manager must first set their personal approval code in Settings.</p>}
    <Label htmlFor="override-code">Manager approval code</Label>
    <Input id="override-code" type="password" inputMode="numeric" autoComplete="off" maxLength={12} value={code} onChange={(e) => setCode(e.target.value)} />
    <Button type="button" size="sm" loading={busy} disabled={!online || !manager || !/^[0-9]{6,12}$/.test(code)} onClick={approve}>Approve this amount</Button>
  </div>;
}

export function OverrideCodeSettings() {
  const { store, can } = useStore();
  const { online } = useOffline();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  if (!can("manager")) return null;
  async function save() {
    setBusy(true);
    try {
      const { error } = await createClient().rpc("set_credit_override_code", { p_business: store.businessId, p_code: code });
      if (error) toast.error(friendlyError(error.message));
      else { setCode(""); toast.success("Your approval code has been set."); }
    } catch { toast.error("Reconnect to save your code."); }
    finally { setBusy(false); }
  }
  return <section className="mt-6 max-w-xl space-y-3 rounded-lg border border-border bg-surface p-5">
    <h2 className="font-semibold">Credit approval code</h2>
    <p className="text-sm text-muted">Set your personal 6–12 digit code to approve a cashier’s sale above a customer’s credit limit. Each approval records you as the manager.</p>
    <Label htmlFor="new-override-code">New personal code</Label>
    <Input id="new-override-code" type="password" inputMode="numeric" autoComplete="new-password" maxLength={12} value={code} onChange={(e) => setCode(e.target.value)} />
    <Button loading={busy} disabled={!online || !/^[0-9]{6,12}$/.test(code)} onClick={save}>Save approval code</Button>
  </section>;
}
