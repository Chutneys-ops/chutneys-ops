// Supabase client with the SECRET key: it skips row-level security and can
// use the Auth admin API (invite, ban). Only More > Staff uses it, and only
// AFTER checking, with the person's own session, that they are an active owner.
//
// "server-only": if any file that ends up in the browser imports this, the
// build fails. The key is read from SUPABASE_SECRET_KEY, which has no
// NEXT_PUBLIC_ prefix, so Next.js never copies it into browser code either.
import "server-only";

import { createClient } from "@supabase/supabase-js";

export function createAdminClient() {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("SUPABASE_SECRET_KEY is not set. See README > Daily start (copy it from `npx supabase status`).");
  }
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, secretKey, {
    // A key, not a person: no session to keep or refresh.
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
