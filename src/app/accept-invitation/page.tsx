"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandLogo } from "@/components/brand-logo";
import { MODULES } from "@/lib/modules";
import type { EmailOtpType } from "@supabase/supabase-js";

type Ticket = {
  id: string;
  secret: string;
  token_hash?: string;
  type?: string;
};
type Details = {
  email: string;
  business: string;
  role: string;
  state: string;
  first_name: string;
  surname: string;
  phone: string;
  needs_password: boolean;
  assignments: Record<string, Record<string, boolean>>;
  stores: Record<string, string>;
};
const STORAGE = "pos-employee-invitation";
export default function AcceptInvitationPage() {
  const router = useRouter();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [details, setDetails] = useState<Details | null>(null);
  const [first, setFirst] = useState("");
  const [surname, setSurname] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    // Reading a link never consumes it. A person must press Confirm email.
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const saved = sessionStorage.getItem(STORAGE);
    let value: Ticket | null = null;
    if (fragment.has("id")) {
      value = Object.fromEntries(fragment) as Ticket;
      history.replaceState(null, "", window.location.pathname);
      sessionStorage.setItem(STORAGE, JSON.stringify(value));
    } else if (saved) {
      try {
        value = JSON.parse(saved);
      } catch {
        sessionStorage.removeItem(STORAGE);
      }
    }
    // Resolve initial state from the browser's external storage asynchronously.
    Promise.resolve(value).then((value) => {
      if (
        value &&
        /^[0-9a-f-]{36}$/i.test(value.id) &&
        /^[0-9a-f]{64}$/i.test(value.secret)
      )
        setTicket(value);
      else
        setError(
          "Open the invitation email from your employer to complete your account.",
        );
    });
  }, []);
  async function verify() {
    if (!ticket || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const db = createClient();
      if (
        ticket.token_hash &&
        ["invite", "magiclink", "signup", "email"].includes(ticket.type ?? "")
      ) {
        const result = await db.auth.verifyOtp({
          token_hash: ticket.token_hash,
          type: ticket.type as EmailOtpType,
        });
        if (result.error) {
          // A resumed setup may already have consumed this email token.
          const current = await db.auth.getUser();
          if (!current.data.user)
            throw new Error(
              "The email link is expired or already used. Ask your owner to resend the invitation.",
            );
        }
      }
      const { data, error } = await db.rpc("employee_invitation_details", {
        p_invitation: ticket.id,
        p_secret: ticket.secret,
      });
      if (error)
        throw new Error(
          "This invitation is invalid, expired, cancelled, or belongs to another email. Ask your owner for a new invitation.",
        );
      const info = data as unknown as Details;
      const remaining = { id: ticket.id, secret: ticket.secret };
      sessionStorage.setItem(STORAGE, JSON.stringify(remaining));
      setTicket(remaining);
      if (info.state === "ACCEPTED") {
        setDone(true);
        sessionStorage.removeItem(STORAGE);
        return;
      }
      setDetails(info);
      setFirst(info.first_name);
      setSurname(info.surname);
      setPhone(info.phone);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not confirm this invitation. Try again.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!ticket || !details || lock.current) return;
    if (
      details.needs_password &&
      (password.length < 8 || password !== confirm)
    ) {
      setError(
        "Use at least 8 characters and enter the same password in both fields.",
      );
      return;
    }
    if (
      phone.replace(/\D/g, "").length < 7 ||
      phone.replace(/\D/g, "").length > 15
    ) {
      setError("Enter a valid phone number with 7 to 15 digits.");
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const db = createClient();
      if (details.needs_password) {
        const { error } = await db.auth.updateUser({ password });
        if (error)
          throw new Error(
            "Could not save that password. Check the password requirements and try again.",
          );
        setDetails({ ...details, needs_password: false });
        setPassword("");
        setConfirm("");
      }
      const { error } = await db.rpc("accept_employee_invitation", {
        p_invitation: ticket.id,
        p_secret: ticket.secret,
        p_first_name: first.trim(),
        p_surname: surname.trim(),
        p_phone: phone.trim(),
      });
      if (error)
        throw new Error(
          "Account setup could not be completed. Your invitation or assigned access may have changed. Retry, or ask your owner to resend it.",
        );
      sessionStorage.removeItem(STORAGE);
      setDone(true);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not complete account setup. Try again.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <main className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto max-w-lg space-y-6">
        <BrandLogo className="mx-auto max-w-64" />
        <section className="space-y-5 rounded-xl border border-border bg-surface p-6">
          <h1 className="text-xl font-semibold">
            {done
              ? "Your account is ready"
              : details
                ? "Complete your account"
                : "Confirm your invitation"}
          </h1>
          {done ? (
            <>
              <p>Your assigned access is active.</p>
              <Button
                onClick={() => {
                  router.replace("/");
                  router.refresh();
                }}
              >
                Continue to POS INVENTORY
              </Button>
            </>
          ) : details ? (
            <form onSubmit={save} className="space-y-4">
              <p>
                You are joining <strong>{details.business}</strong>.
              </p>
              <div>
                <Label htmlFor="setup-email">Email address</Label>
                <Input id="setup-email" readOnly value={details.email} />
                <p className="text-xs text-muted">
                  Your email is managed by your employer.
                </p>
              </div>
              <div>
                <Label htmlFor="setup-first">First name(s)</Label>
                <Input
                  id="setup-first"
                  required
                  maxLength={100}
                  autoComplete="given-name"
                  value={first}
                  onChange={(e) => setFirst(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="setup-surname">Surname</Label>
                <Input
                  id="setup-surname"
                  required
                  maxLength={100}
                  autoComplete="family-name"
                  value={surname}
                  onChange={(e) => setSurname(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="setup-phone">Phone number</Label>
                <Input
                  id="setup-phone"
                  required
                  type="tel"
                  maxLength={32}
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
              {details.needs_password && (
                <>
                  <div>
                    <Label htmlFor="setup-password">Password</Label>
                    <Input
                      id="setup-password"
                      required
                      minLength={8}
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <p className="text-xs text-muted">
                      Use at least 8 characters. Your employer will not see your
                      password.
                    </p>
                  </div>
                  <div>
                    <Label htmlFor="setup-confirm">Confirm password</Label>
                    <Input
                      id="setup-confirm"
                      required
                      type="password"
                      autoComplete="new-password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                    />
                  </div>
                </>
              )}
              <div className="space-y-2 rounded-md border border-border p-3 text-sm">
                <p className="font-medium">Assigned access</p>
                {details.role === "owner" ? (
                  <p>Owner access to all business stores.</p>
                ) : (
                  Object.entries(details.assignments).map(
                    ([id, permissions]) => (
                      <p key={id}>
                        <strong>{details.stores[id] ?? "Store"}</strong>:{" "}
                        {MODULES.filter((m) => permissions[m.key])
                          .map((m) => m.label)
                          .join(", ") || "No modules assigned"}
                      </p>
                    ),
                  )
                )}
              </div>
              <Button type="submit" loading={busy} className="w-full">
                Save and continue
              </Button>
            </form>
          ) : (
            <>
              <p>
                Confirm that you received this invitation, then enter your
                details and choose your password.
              </p>
              {ticket && (
                <Button onClick={verify} loading={busy}>
                  Confirm email and continue
                </Button>
              )}
            </>
          )}
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <Button
            variant="ghost"
            disabled={busy}
            onClick={async () => {
              sessionStorage.removeItem(STORAGE);
              await createClient().auth.signOut();
              router.replace("/login");
              router.refresh();
            }}
          >
            Sign out
          </Button>
        </section>
      </div>
    </main>
  );
}
