"use server";

import { redirect } from "next/navigation";
import { authErrorMessage, setPasswordProblem } from "@/lib/passwords";
import { createClient } from "@/lib/supabase/server";

export type SetPasswordState = { error: string | null };

// The person arrived from an invite or reset link (/auth/confirm), so they
// have a session but may have no password yet. No current password needed:
// Supabase skips that check for sessions started from an email link.
export async function setPassword(_prev: SetPasswordState, formData: FormData): Promise<SetPasswordState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) {
    return { error: "Your link has expired. Use Forgot password on the sign-in page to get a new one." };
  }
  const email = typeof data.claims.email === "string" ? data.claims.email : null;

  const problem = setPasswordProblem(password, confirm, email);
  if (problem) return { error: problem };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: authErrorMessage(error.code, `Could not save your password: ${error.message}`) };

  // redirect() throws, so it must be outside any try/catch.
  redirect("/home");
}
