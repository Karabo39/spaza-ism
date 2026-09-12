"use client";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
export function PrintReceipt({
  type,
  id,
  onPrint,
}: {
  type: "invoice" | "return" | "sale";
  id: string;
  onPrint?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [configured, setConfigured] = useState(false);
  const [sent, setSent] = useState(false);
  const attempt = useRef<{ recipient: string; id: string } | null>(null);
  const sending = useRef(false);
  async function prepare() {
    setOpen(true);
    setBusy(true);
    setError("");
    setSent(false);
    setConfigured(false);
    attempt.current = null;
    try {
      const r = await fetch(`/api/documents/email?type=${type}&id=${id}`, {
        cache: "no-store",
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setRecipient(data.recipient);
      setConfigured(data.configured);
      if (!data.configured)
        setError(
          "Email is not configured yet. Your administrator needs to configure the verified sender.",
        );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (sending.current || !configured) return;
    sending.current = true;
    setBusy(true);
    setError("");
    const email = recipient.trim();
    if (attempt.current?.recipient !== email)
      attempt.current = { recipient: email, id: crypto.randomUUID() };
    try {
      const r = await fetch("/api/documents/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          id,
          recipient: email,
          requestId: attempt.current.id,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setSent(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      sending.current = false;
    }
  }
  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      <Button onClick={onPrint ?? (() => window.print())}>
        Print / save PDF
      </Button>
      <Button onClick={prepare}>Email document</Button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!busy) setOpen(v);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Email document</DialogTitle>
            <DialogDescription>
              Send a PDF copy. Use the customer’s saved email or enter another
              address.
            </DialogDescription>
          </DialogHeader>
          {sent ? (
            <p role="status">Email accepted for delivery.</p>
          ) : (
            <form onSubmit={send} className="space-y-4">
              <label>
                Recipient email
                <Input
                  type="email"
                  required
                  maxLength={254}
                  value={recipient}
                  disabled={busy}
                  onChange={(e) => setRecipient(e.target.value)}
                />
              </label>
              {error && (
                <p role="alert" className="text-danger">
                  {error}
                </p>
              )}
              <Button
                type="submit"
                loading={busy}
                disabled={!configured || !recipient.trim()}
              >
                Send PDF
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
