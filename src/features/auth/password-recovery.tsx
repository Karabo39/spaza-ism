"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
export function PasswordRecovery({ reset = false }: { reset?: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [busy, setBusy] = useState(false),
    [sent, setSent] = useState(false),
    [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (reset && (password.length < 8 || password !== confirmation)) {
      setError("Use at least 8 characters and enter the same password twice.");
      return;
    }
    setBusy(true);
    try {
      const db = createClient();
      if (reset) {
        const { error } = await db.auth.updateUser({ password });
        if (error) throw error;
        setPassword("");
        setConfirmation("");
        router.replace("/");
        router.refresh();
      } else {
        const { error } = await db.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
        });
        if (error) throw error;
        setSent(true);
      }
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not complete the request. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-20">
      <section className="w-full max-w-sm rounded-lg border border-border bg-surface p-6">
        <h1 className="text-xl font-semibold">
          {reset ? "Choose a new password" : "Reset your password"}
        </h1>
        {sent ? (
          <p role="status" className="mt-4 text-sm">
            If this address has an account, a reset link is on its way. Open it
            in this browser to choose a new password.
          </p>
        ) : (
          <form onSubmit={submit} className="mt-5 space-y-4">
            {reset ? (
              <>
                <div>
                  <Label htmlFor="new-password">New password</Label>
                  <Input
                    id="new-password"
                    required
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="confirm-password">Confirm password</Label>
                  <Input
                    id="confirm-password"
                    required
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                  />
                </div>
              </>
            ) : (
              <div>
                <Label htmlFor="recovery-email">Account email</Label>
                <Input
                  id="recovery-email"
                  required
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            )}
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <Button className="w-full" loading={busy} type="submit">
              {reset ? "Save new password" : "Send reset link"}
            </Button>
          </form>
        )}
        <Link href="/login" className="mt-5 inline-block text-sm text-accent">
          Return to sign in
        </Link>
      </section>
    </main>
  );
}
