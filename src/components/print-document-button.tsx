"use client";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { printDocument } from "@/lib/print-document";
export function PrintDocumentButton({
  href,
  children = "Print / save PDF",
}: {
  href: string;
  children?: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false),
    lock = useRef(false);
  return (
    <Button
      loading={busy}
      onClick={async () => {
        if (lock.current) return;
        lock.current = true;
        setBusy(true);
        try {
          await printDocument(href);
        } catch (e) {
          toast.error((e as Error).message);
        } finally {
          lock.current = false;
          setBusy(false);
        }
      }}
    >
      {children}
    </Button>
  );
}
