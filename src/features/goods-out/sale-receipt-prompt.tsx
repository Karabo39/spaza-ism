"use client";
import { useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { money } from "@/lib/format";
export function SaleReceiptPrompt({
  id,
  total,
  currency,
  onDone,
}: {
  id: string;
  total: number;
  currency: string;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const locked = useRef(false);
  return (
    <Dialog open>
      <DialogContent
        hideClose
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogTitle>Receipt Print</DialogTitle>
        <DialogDescription>
          Sale completed — {money(total, currency)}. Would you like to print the
          receipt?
        </DialogDescription>
        <p className="break-all text-xs text-muted">
          POS-{id.replaceAll("-", "").toUpperCase()}
        </p>
        <div className="flex flex-wrap gap-3">
          <Button
            className="bg-success text-black hover:bg-success/90"
            disabled={busy}
            onClick={() => {
              const receipt = window.open(
                `/goods-out/${id}/receipt?autoprint=1`,
                "_blank",
              );
              if (!receipt) {
                setError(
                  "Allow the receipt tab to open, then try Print Receipt again. Your sale is saved.",
                );
                return;
              }
              receipt.opener = null;
              onDone();
            }}
          >
            Print Receipt
          </Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={async () => {
              if (locked.current) return;
              locked.current = true;
              setBusy(true);
              setError("");
              try {
                const { error } = await createClient().rpc(
                  "record_receipt_print",
                  { p_sale: id, p_action: "DECLINED" },
                );
                if (error) throw error;
                onDone();
              } catch {
                setError(
                  "Could not record your choice. Try again; your sale remains saved.",
                );
              } finally {
                locked.current = false;
                setBusy(false);
              }
            }}
          >
            Don’t Print
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
