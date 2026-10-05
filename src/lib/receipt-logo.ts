import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./db/database.types";
import { decodeDocumentLogo } from "../../supabase/functions/_shared/document-logo";

/** Receipt-only fallback: an explicit document logo always takes precedence. */
export async function loadReceiptLogo(
  db: SupabaseClient<Database>,
  businessId: string,
) {
  const { data, error } = await db
    .from("businesses")
    .select("document_logo_path,logo_path")
    .eq("id", businessId)
    .single();
  if (error) throw error;
  const path = data.document_logo_path || data.logo_path;
  if (!path) return null;
  const asset = await db.storage
    .from(data.document_logo_path ? "document-logos" : "business-logos")
    .download(path);
  if (asset.error) throw asset.error;
  if (asset.data.size > 2 * 1024 * 1024)
    throw new Error("Receipt logo exceeds image limit");
  const bytes = new Uint8Array(await asset.data.arrayBuffer());
  if (data.document_logo_path) return decodeDocumentLogo(bytes);
  // Business logos can be JPEG/WebP; normalise to a small printable PNG on the server.
  const sharp = (await import("sharp")).default;
  return decodeDocumentLogo(
    await sharp(bytes, { limitInputPixels: 16 * 1024 * 1024 })
      .resize({
        width: 512,
        height: 512,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer(),
  );
}
