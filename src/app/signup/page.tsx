"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldCheck, MailCheck } from "lucide-react";

export default function SignupPage() {
  const router = useRouter();
  const [fullName, setFullName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [needsConfirm, setNeedsConfirm] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: fullName.trim() } },
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    if (data.session) {
      router.replace("/onboarding");
      router.refresh();
    } else {
      setNeedsConfirm(true);
    }
  }

  if (needsConfirm) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6 text-center">
          <MailCheck className="mx-auto mb-3 size-8 text-success" />
          <h1 className="text-base font-semibold">Confirm your email</h1>
          <p className="mt-2 text-sm text-muted">
            We sent a confirmation link to <span className="text-foreground">{email}</span>. Confirm it,
            then sign in.
          </p>
          <Button asChild className="mt-5 w-full"><Link href="/login">Go to sign in</Link></Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ShieldCheck className="size-5" />
          </div>
          <div>
            <p className="text-lg font-semibold">Spaza ISM</p>
            <p className="text-xs text-muted">Inventory Management System</p>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-6 shadow-sm">
          <h1 className="text-base font-semibold">Create your account</h1>
          <p className="mb-5 mt-1 text-xs text-muted">You&apos;ll set up your shop next.</p>
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <Label htmlFor="name">Full name</Label>
              <Input id="name" required value={fullName} onChange={(e) => setFullName(e.target.value)}
                placeholder="Thandi Nkosi" />
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" required value={email}
                onChange={(e) => setEmail(e.target.value)} placeholder="you@shop.co.za" />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" autoComplete="new-password" required minLength={6}
                value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" />
            </div>
            {error ? <p className="text-xs text-danger">{error}</p> : null}
            <Button type="submit" className="w-full" loading={loading}>Create account</Button>
          </form>
        </div>
        <p className="mt-4 text-center text-xs text-muted">
          Already have an account?{" "}
          <Link href="/login" className="text-accent hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
