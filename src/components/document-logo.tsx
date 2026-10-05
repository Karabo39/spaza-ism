/* eslint-disable @next/next/no-img-element -- Inline document image bytes must remain printable without an image proxy. */
import { createClient } from "@/lib/supabase/server";
import { loadDocumentLogo } from "@/lib/document-logo";
import { loadReceiptLogo } from "@/lib/receipt-logo";
export async function DocumentLogo({
  businessId,
  receiptFallback = false,
}: {
  businessId: string;
  receiptFallback?: boolean;
}) {
  const db = await createClient();
  const logo = receiptFallback
    ? await loadReceiptLogo(db, businessId)
    : await loadDocumentLogo(db, businessId);
  if (!logo) return null;
  // Inline bytes are ready before auto-print; signed image URLs cannot expire mid-print.

  return (
    <img
      src={logo.dataUrl}
      alt="Document logo"
      width={logo.width}
      height={logo.height}
      style={{
        display: "block",
        objectFit: "contain",
        objectPosition: "left",
        width: "auto",
        height: "auto",
        maxWidth: "min(45mm, 100%)",
        maxHeight: "22mm",
        marginBottom: "4mm",
      }}
    />
  );
}
