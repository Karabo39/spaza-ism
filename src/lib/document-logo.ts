import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./db/database.types";
import { decodeDocumentLogo } from "../../supabase/functions/_shared/document-logo";
export { logoSize } from "../../supabase/functions/_shared/document-logo";
export type { DocumentLogo } from "../../supabase/functions/_shared/document-logo";
export async function loadDocumentLogo(
  db: SupabaseClient<Database>,
  businessId: string,
) {
  const { data, error } = await db
    .from("businesses")
    .select("document_logo_path")
    .eq("id", businessId)
    .single();
  if (error) throw error;
  if (!data.document_logo_path) return null;
  const downloaded = await db.storage
    .from("document-logos")
    .download(data.document_logo_path);
  if (downloaded.error) throw downloaded.error;
  return decodeDocumentLogo(
    new Uint8Array(await downloaded.data.arrayBuffer()),
  );
}
