"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
export function DeliveryPrint() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="print:hidden">
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await Promise.all(
              Array.from(
                document.querySelectorAll<HTMLImageElement>("#receipt img"),
              ).map((i) => i.decode()),
            );
            if (document.fonts) await document.fonts.ready;
            window.print();
          } catch {
            setError(
              "Could not load the document image. Refresh before printing.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        Print / save delivery note
      </Button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
