"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBillingAction } from "./use-billing-action";
import type { PurchaseOrder as PO } from "@/lib/db/database.types";
const columns =
  "id,store_id,quote_id,order_id,received,approved,reference,filename,mime,version,updated_by,updated_at,approved_by,approved_at";
export function PurchaseOrder({
  quote,
  order,
  saved,
}: {
  saved?: () => void;
  quote?: string;
  order?: string;
}) {
  const query = useQuery({
    queryKey: ["billing", "purchase-order", quote, order],
    queryFn: async () => {
      const { data, error } = await createClient()
        .from("sales_purchase_orders")
        .select(columns)
        .eq(quote ? "quote_id" : "order_id", quote ?? order!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  if (query.error)
    return (
      <p role="alert">
        Could not load the purchase order.{" "}
        <Button onClick={() => query.refetch()}>Retry</Button>
      </p>
    );
  if (query.isLoading) return <p>Loading purchase order...</p>;
  return (
    <POEditor
      key={`${quote ?? order}:${query.data?.version ?? 0}`}
      quote={quote}
      order={order}
      initial={query.data ?? null}
      saved={saved}
    />
  );
}
function POEditor({
  quote,
  order,
  initial,
  saved,
}: {
  saved?: () => void;
  quote?: string;
  order?: string;
  initial: PO | null;
}) {
  const { can } = useStore();
  const { online, busy, run } = useBillingAction();
  const [received, setReceived] = useState(initial?.received ?? false);
  const [approved, setApproved] = useState(initial?.approved ?? false);
  const [reference, setReference] = useState(initial?.reference ?? "");
  const [file, setFile] = useState<File | null>(null);
  const locked = !!initial?.approved && !can("manager");
  async function save() {
    let content: string | null = null;
    if (file) {
      if (
        file.size > 2097152 ||
        !["application/pdf", "image/png", "image/jpeg"].includes(file.type)
      ) {
        toast.error("Choose a PDF, PNG or JPEG up to 2 MB.");
        return;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      content = btoa(binary);
    }
    await run(
      () =>
        createClient().rpc("save_purchase_order", {
          p_quote: quote ?? null,
          p_order: order ?? null,
          p_received: received,
          p_approved: approved,
          p_reference: reference,
          p_filename: file?.name ?? null,
          p_mime: file?.type ?? null,
          p_content: content,
          p_expected: initial?.version ?? 0,
        }),
      "Purchase order saved",
      saved,
    );
  }
  async function download() {
    try {
      const { data, error } = await createClient().rpc(
        "download_purchase_order",
        { p_id: initial!.id },
      );
      if (error) throw error;
      const doc = data as { filename: string; mime: string; content: string };
      const bytes = Uint8Array.from(atob(doc.content), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: doc.mime }));
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      toast.error("Could not download the purchase order.");
    }
  }
  return (
    <fieldset className="space-y-3 rounded-lg border border-border p-4">
      <legend className="px-2 font-semibold">
        Customer purchase order (optional)
      </legend>
      <p className="text-sm text-muted-foreground">
        Trusted customers can proceed without a PO. Attachments follow the
        quotation through to its order and invoice.
      </p>
      <div className="flex flex-wrap gap-4">
        <label>
          <input
            type="checkbox"
            checked={received}
            disabled={locked}
            onChange={(e) => {
              setReceived(e.target.checked);
              if (!e.target.checked) setApproved(false);
            }}
          />{" "}
          PO received
        </label>
        <label>
          <input
            type="checkbox"
            checked={approved}
            disabled={!received || !can("manager")}
            onChange={(e) => setApproved(e.target.checked)}
          />{" "}
          PO approved by manager/owner
        </label>
      </div>
      <Input
        aria-label="Customer PO reference"
        value={reference}
        disabled={locked}
        onChange={(e) => setReference(e.target.value)}
        placeholder="Customer PO number"
      />
      <Input
        aria-label="Attach purchase order"
        type="file"
        accept="application/pdf,image/png,image/jpeg"
        disabled={locked}
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <p className="text-xs text-muted-foreground">
        PDF, PNG or JPEG, up to 2 MB.{" "}
        {initial?.approved_at
          ? `Approved ${new Date(initial.approved_at).toLocaleString()}.`
          : ""}
      </p>
      {initial?.filename && (
        <Button variant="secondary" onClick={download}>
          Download {initial.filename}
        </Button>
      )}
      <Button loading={busy} disabled={!online || locked} onClick={save}>
        {saved ? "Save purchase order and accept quote" : "Save purchase order"}
      </Button>
    </fieldset>
  );
}
