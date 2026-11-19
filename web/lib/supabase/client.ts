import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for Client Components (code that runs in the browser).
 * It reads the same session cookies as the server client, so every request
 * carries the signed-in user's token and RLS applies as normal.
 * Used for uploading invoice files straight to Storage.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
