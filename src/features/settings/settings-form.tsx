"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store-context";
import { friendlyError } from "@/lib/format";

export function SettingsForm({
  profile, storeInfo, business,
}: {
  profile: { full_name: string; phone: string };
  storeInfo: { id: string; name: string; code: string };
  business: { id: string; name: string; currency: string };
}) {
  const router = useRouter();
  const { can } = useStore();
  const [p, setP] = React.useState(profile);
  const [s, setS] = React.useState(storeInfo);
  const [b, setB] = React.useState(business);
  const [busy, setBusy] = React.useState<string | null>(null);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault(); setBusy("profile");
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("profiles").update({ full_name: p.full_name.trim(), phone: p.phone.trim() || null }).eq("id", user!.id);
    setBusy(null);
    if (error) toast.error(friendlyError(error.message));
    else { toast.success("Profile saved"); router.refresh(); }
  }

  async function saveStore(e: React.FormEvent) {
    e.preventDefault(); setBusy("store");
    const supabase = createClient();
    const { error } = await supabase.from("stores").update({ name: s.name.trim(), code: s.code.trim() || null }).eq("id", s.id);
    setBusy(null);
    if (error) toast.error(friendlyError(error.message));
    else { toast.success("Store saved"); router.refresh(); }
  }

  async function saveBusiness(e: React.FormEvent) {
    e.preventDefault(); setBusy("business");
    const supabase = createClient();
    const { error } = await supabase.from("businesses").update({ name: b.name.trim(), currency: b.currency.trim() || "ZAR" }).eq("id", b.id);
    setBusy(null);
    if (error) toast.error(friendlyError(error.message));
    else { toast.success("Business saved"); router.refresh(); }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Your profile</CardTitle><CardDescription>How you appear in transactions and audit logs.</CardDescription></CardHeader>
        <CardContent>
          <form onSubmit={saveProfile} className="space-y-4">
            <div><Label htmlFor="full">Full name</Label><Input id="full" value={p.full_name} onChange={(e) => setP({ ...p, full_name: e.target.value })} /></div>
            <div><Label htmlFor="phone">Phone</Label><Input id="phone" value={p.phone} onChange={(e) => setP({ ...p, phone: e.target.value })} /></div>
            <Button type="submit" loading={busy === "profile"}>Save profile</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Store</CardTitle><CardDescription>{can("manager") ? "Details for the active store." : "Managers can edit store details."}</CardDescription></CardHeader>
        <CardContent>
          <form onSubmit={saveStore} className="space-y-4">
            <div><Label htmlFor="sname">Store name</Label><Input id="sname" value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} disabled={!can("manager")} /></div>
            <div><Label htmlFor="scode">Store code</Label><Input id="scode" value={s.code} onChange={(e) => setS({ ...s, code: e.target.value })} disabled={!can("manager")} placeholder="e.g. MAIN" /></div>
            {can("manager") ? <Button type="submit" loading={busy === "store"}>Save store</Button> : null}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Business</CardTitle><CardDescription>{can("owner") ? "Business name and currency." : "Owners can edit business details."}</CardDescription></CardHeader>
        <CardContent>
          <form onSubmit={saveBusiness} className="space-y-4">
            <div><Label htmlFor="bname">Business name</Label><Input id="bname" value={b.name} onChange={(e) => setB({ ...b, name: e.target.value })} disabled={!can("owner")} /></div>
            <div><Label htmlFor="cur">Currency code</Label><Input id="cur" value={b.currency} onChange={(e) => setB({ ...b, currency: e.target.value.toUpperCase() })} disabled={!can("owner")} maxLength={3} placeholder="ZAR" /></div>
            {can("owner") ? <Button type="submit" loading={busy === "business"}>Save business</Button> : null}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
