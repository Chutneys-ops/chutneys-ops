import type { EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// The link in invite and password reset emails lands here:
//   /auth/confirm?token_hash=...&type=invite   (or type=recovery)
// verifyOtp checks the one-time token with Supabase Auth. If it's good,
// Auth starts a session and the server client stores it in cookies; then
// the person chooses a password on /set-password.
//
// Only these two types: a sign-up or email-change link has no business here.
const ALLOWED_TYPES: EmailOtpType[] = ["invite", "recovery"];

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type") as EmailOtpType | null;

  if (tokenHash && type && ALLOWED_TYPES.includes(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    // redirect() throws, so it stays outside any try/catch.
    if (!error) redirect("/set-password");
  }

  // Expired, already used, or a turned-off account.
  redirect("/login?notice=link");
}
