"use client";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { printDocument } from "@/lib/print-document";
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
  const receipt = useQuery({
    queryKey: ["receipt-print", id],
    queryFn: async () => {
      const db = createClient();
      const { data, error } = await db
        .from("sale_receipts")
        .select("reference,store_id")
        .eq("sale_id", id)
        .single();
      if (error) throw error;
      const prefs = await db
        .from("receipt_preferences")
        .select("second_copy,delay_seconds")
        .eq("store_id", data.store_id)
        .maybeSingle();
      if (prefs.error) throw prefs.error;
      return { ...data, preferences: prefs.data };
    },
  });
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
          {receipt.data?.reference ?? "Receipt saved"}
        </p>
        <div className="flex flex-wrap gap-3">
          <Button
            className="bg-success text-black hover:bg-success/90"
            disabled={busy || !receipt.data}
            onClick={async () => {
              if (locked.current || !receipt.data) return;
              locked.current = true;
              setBusy(true);
              setError("");
              try {
                const copies = receipt.data.preferences?.second_copy ? 2 : 1;
                for (let copy = 0; copy < copies; copy++) {
                  if (copy)
                    await new Promise((resolve) =>
                      setTimeout(
                        resolve,
                        (receipt.data!.preferences?.delay_seconds ?? 3) * 1000,
                      ),
                    );
                  const { error } = await createClient().rpc(
                    "record_receipt_print",
                    {
                      p_sale: id,
                      p_action: copy ? "COPY_REQUESTED" : "REQUESTED",
                    },
                  );
                  if (error) throw error;
                  await printDocument(`/goods-out/${id}/receipt`);
                }
                onDone();
              } catch {
                setError(
                  "Printing could not finish. Your sale is saved; retry or choose Don't Print.",
                );
              } finally {
                locked.current = false;
                setBusy(false);
              }
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
        {receipt.error && (
          <p role="alert">
            Could not load receipt settings.{" "}
            <Button onClick={() => receipt.refetch()}>Retry</Button>
          </p>
        )}
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
