"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Store, Warehouse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { useStore } from "@/lib/store-context";
import { useOffline } from "@/lib/offline/offline-context";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/format";
import type { LocationType } from "@/lib/db/database.types";
import { ACTIVE_STORE_COOKIE } from "@/lib/constants";

export function LocationsManager({ activateOnCreate = false }: { activateOnCreate?: boolean }) {
  const { store, stores, can } = useStore();
  const { online } = useOffline();
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [code, setCode] = React.useState("");
  const [type, setType] = React.useState<LocationType>("store");
  const [busy, setBusy] = React.useState(false);
  if (!can("owner")) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!online || busy) return;
    setBusy(true);
    try {
      const { data, error } = await createClient().rpc("create_location", {
        p_business: store.businessId, p_name: name.trim(), p_type: type, p_code: code.trim(),
      });
      if (error) throw error;
      if (activateOnCreate && typeof data === "string" && /^[a-f0-9-]{36}$/i.test(data)) {
        document.cookie = `${ACTIVE_STORE_COOKIE}=${data}; path=/; max-age=31536000; samesite=lax`;
      }
      setName(""); setCode("");
      toast.success("Location created. Assign staff access in Users.");
      router.refresh();
    } catch (error) {
      toast.error(friendlyError((error as Error).message));
    } finally { setBusy(false); }
  }

  return (
    <Card className="mt-5" id="new-location">
      <CardHeader>
        <CardTitle>{activateOnCreate ? "Add a store or warehouse" : "Stores & warehouses"}</CardTitle>
        <CardDescription>Each location has its own stock and stock take. Warehouses hold stock and cannot record sales.</CardDescription>
      </CardHeader>
      <CardContent className={activateOnCreate ? "max-w-2xl" : "grid gap-6 lg:grid-cols-2"}>
        {!activateOnCreate && <ul className="divide-y divide-border">
          {stores.filter((s) => s.businessId === store.businessId).map((s) => {
            const Icon = s.locationType === "warehouse" ? Warehouse : Store;
            return <li key={s.id} className="flex items-center gap-3 py-3"><Icon className="size-5 text-muted" /><div><p className="font-medium">{s.name}</p><p className="text-xs capitalize text-muted">{s.locationType}</p></div></li>;
          })}
        </ul>}
        <form onSubmit={submit} className="space-y-4">
          <div><Label htmlFor="location-name">New location name</Label><Input id="location-name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Central warehouse" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label htmlFor="location-type">Location type</Label><select id="location-type" className="h-10 w-full rounded-md border border-border bg-input px-3 text-sm" value={type} onChange={(e) => setType(e.target.value as LocationType)}><option value="store">Selling store</option><option value="warehouse">Warehouse</option></select></div>
            <div><Label htmlFor="location-code">Code (optional)</Label><Input id="location-code" value={code} maxLength={30} onChange={(e) => setCode(e.target.value)} /></div>
          </div>
          <p className="text-xs text-muted">Owners have access to every location. Assign managers and standard users in Users. Creating locations requires a connection.</p>
          <Button type="submit" loading={busy} disabled={!online || !name.trim()}>{activateOnCreate ? type === "store" ? "Add store" : "Add warehouse" : "Add location"}</Button>
        </form>
      </CardContent>
    </Card>
  );
}
