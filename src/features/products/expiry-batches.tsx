"use client";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { friendlyError, qty } from "@/lib/format";
export function ExpiryBatches({
  product,
  undated,
  batches,
}: {
  product: string;
  undated: number;
  batches: { id: string; quantity: number; expiry_date: string | null }[];
}) {
  const { can } = useStore();
  const router = useRouter();
  const lock = useRef(false);
  const [date, setDate] = useState("");
  const [quantity, setQuantity] = useState(String(undated));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <section
      id="expiry-batches"
      className="mb-5 space-y-3 rounded-lg border border-border bg-surface p-5"
    >
      <h2 className="font-semibold">Expiry batches</h2>
      <p className="text-sm text-muted">
        Dates apply to batches. Expired and undated tracked stock cannot be
        sold. Stock dated today remains sellable today.
      </p>
      <ul className="divide-y divide-border">
        {batches.map((b) => (
          <li className="flex justify-between gap-3 py-2 text-sm" key={b.id}>
            <span>{b.expiry_date ?? "Date required"}</span>
            <span>{qty(b.quantity)} units</span>
            {can("manager") && b.quantity > 0 && b.expiry_date && (
              <BatchCorrection batch={b} />
            )}
          </li>
        ))}
      </ul>
      {undated > 0 && (
        <p className="text-sm">
          {qty(undated)} units still need an expiry date.
        </p>
      )}
      {can("manager") && undated > 0 && (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (lock.current) return;
            lock.current = true;
            setBusy(true);
            setError("");
            try {
              const { error } = await createClient().rpc(
                "assign_stock_expiry",
                {
                  p_product: product,
                  p_expiry: date,
                  p_quantity: Number(quantity),
                  p_expected: undated,
                },
              );
              if (error) throw error;
              router.refresh();
            } catch (e) {
              setError(friendlyError((e as Error).message));
            } finally {
              lock.current = false;
              setBusy(false);
            }
          }}
        >
          <div>
            <Label htmlFor="batch-quantity">Quantity with this date</Label>
            <Input
              id="batch-quantity"
              type="number"
              min="0.001"
              max={undated}
              step="0.001"
              required
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="batch-expiry">Expiry date</Label>
            <Input
              id="batch-expiry"
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <Button type="submit" loading={busy}>
            Assign expiry
          </Button>
          <p className="w-full text-xs text-muted">
            This dates existing stock; it does not add quantity. Repeat for
            stock with a different date.
          </p>
        </form>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

function BatchCorrection({
  batch,
}: {
  batch: { id: string; quantity: number; expiry_date: string | null };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(batch.expiry_date || "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  return (
    <div>
      <Button size="sm" variant="secondary" onClick={() => setOpen(!open)}>
        Correct date
      </Button>
      {open && (
        <form
          className="mt-2 space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (lock.current) return;
            lock.current = true;
            setBusy(true);
            setError("");
            try {
              const { error } = await createClient().rpc(
                "correct_batch_expiry",
                {
                  p_batch: batch.id,
                  p_expiry: date,
                  p_expected_expiry: batch.expiry_date,
                  p_expected_quantity: batch.quantity,
                  p_reason: reason,
                },
              );
              if (error) throw error;
              setOpen(false);
              router.refresh();
            } catch (e) {
              setError(friendlyError((e as Error).message));
            } finally {
              setBusy(false);
              lock.current = false;
            }
          }}
        >
          <Input
            aria-label="Corrected batch expiry"
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <Input
            aria-label="Reason for expiry correction"
            required
            maxLength={500}
            placeholder="Reason for correction"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <p className="text-xs text-muted">
            Applies to these {qty(batch.quantity)} units only. Original receipts
            stay unchanged.
          </p>
          <Button type="submit" loading={busy}>
            Save corrected date
          </Button>
          {error && <p role="alert">{error}</p>}
        </form>
      )}
    </div>
  );
}
