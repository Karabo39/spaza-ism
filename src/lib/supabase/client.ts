import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/db/database.types";

/** Browser Supabase client (uses the publishable/anon key; RLS-governed). */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
