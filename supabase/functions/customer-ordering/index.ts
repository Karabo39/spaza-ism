import { createClient } from "npm:@supabase/supabase-js@2.112.4";
import { orderingHandler } from "./handler.ts";
const client = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
Deno.serve(
  orderingHandler({
    rpc: (name, args) => client.rpc(name, args),
    images: async (paths) => {
      const { data } = await client.storage
        .from("online-product-images")
        .createSignedUrls(paths, 900);
      return Object.fromEntries(
        (data || []).map((asset) => [asset.path!, asset.signedUrl || null]),
      );
    },
  }),
);
