"use client";
import { Copy } from "lucide-react";
import { toast } from "sonner";
export function BarcodeCopy({ barcode }: { barcode: string }) {
  return (
    <button
      type="button"
      title={`Copy barcode ${barcode}`}
      aria-label={`Copy barcode ${barcode}`}
      className="focus-ring inline-flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2 py-1 font-mono text-xs"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(barcode);
          toast.success("Barcode copied.");
        } catch {
          toast.error(
            "Clipboard unavailable. Select the barcode text and copy it.",
          );
        }
      }}
    >
      {barcode}
      <Copy className="size-3" />
    </button>
  );
}
