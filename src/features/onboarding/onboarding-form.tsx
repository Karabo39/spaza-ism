"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Store } from "lucide-react";
import { friendlyError } from "@/lib/format";

export default function OnboardingPage() {
  const router = useRouter();
  const [business, setBusiness] = React.useState("");
  const [store, setStore] = React.useState("Main Store");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("create_business", {
      p_name: business.trim(),
      p_store_name: store.trim() || "Main Store",
    });
    setLoading(false);
    if (error) {
      setError(friendlyError(error.message));
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Store className="size-5" />
          </div>
          <div>
            <p className="text-lg font-semibold">Set up your shop</p>
            <p className="text-xs text-muted">This takes a few seconds.</p>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-6 shadow-sm">
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <Label htmlFor="business">Business name</Label>
              <Input id="business" required value={business} onChange={(e) => setBusiness(e.target.value)}
                placeholder="Thandi's Spaza" autoFocus />
            </div>
            <div>
              <Label htmlFor="store">Store / branch name</Label>
              <Input id="store" required value={store} onChange={(e) => setStore(e.target.value)}
                placeholder="Main Store" />
              <p className="mt-1.5 text-xs text-muted">You can add more stores later.</p>
            </div>
            {error ? <p className="text-xs text-danger">{error}</p> : null}
            <Button type="submit" className="w-full" loading={loading}>Create shop &amp; continue</Button>
          </form>
        </div>
      </div>
    </div>
  );
}
