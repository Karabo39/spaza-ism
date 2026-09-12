"use client";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { PrintReceipt } from "@/features/billing/print-receipt";
export function SalePrintActions({
  id,
  secondCopy,
  delay,
}: {
  id: string;
  secondCopy: boolean;
  delay: number;
}) {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const printing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  async function print(copy = false) {
    if (printing.current) return;
    printing.current = true;
    setBusy(true);
    try {
      const { error } = await createClient().rpc("record_receipt_print", {
        p_sale: id,
        p_action: copy ? "COPY_REQUESTED" : "REQUESTED",
      });
      if (error) {
        toast.error(
          "Could not record the print request. Try again; your sale is saved.",
        );
        return;
      }
      window.print();
      if (!copy && secondCopy) {
        setReady(false);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          setReady(true);
          void print(true);
        }, delay * 1000);
      }
    } catch {
      toast.error(
        "Printing could not start. Your sale remains saved; try printing again.",
      );
    } finally {
      printing.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2 print:hidden">
      <PrintReceipt type="sale" id={id} onPrint={() => print()} />
      {ready && (
        <Button disabled={busy} onClick={() => print(true)}>
          Print second copy again
        </Button>
      )}
      <p className="text-xs text-muted">
        Print requests are recorded. Paper output cannot be verified by the
        browser. Cancelling printing does not cancel the sale.
      </p>
    </div>
  );
}
