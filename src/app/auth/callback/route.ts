import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeAuthPath } from "@/lib/auth-redirect";

/** Sanitise the post-auth redirect so it can only point inside this app. */

/**
 * OAuth / magic-link / same-device email confirmation land here with a `code`.
 * Exchange it for a session (sets the cookies) and continue into the app.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeAuthPath(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }
  return NextResponse.redirect(`${origin}/login?error=auth`);
}
