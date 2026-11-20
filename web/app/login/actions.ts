"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { error: string | null };

export async function login(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Keep it vague on purpose: don't reveal whether the email exists.
    // That includes turned-off (banned) accounts: Supabase Auth says
    // "user_banned" even when the password is wrong, so showing "your
    // account is turned off" would tell anyone that the email was staff.
    return { error: "Email or password is incorrect." };
  }

  // Owners and managers (and anyone who turned it on) type a code next.
  // Home would send them there anyway; this saves a hop.
  const { data: step } = await supabase.rpc("mfa_status");

  // redirect() throws, so it must be outside any try/catch.
  // Always Home after signing in: never a "next" or last-visited page.
  redirect(step === "enrol" || step === "verify" ? "/mfa" : "/home");
}

/** Signs out on the server. The browser then loads /login itself (a full
 *  page load, see sign-out-button.tsx), so nothing from the last person's
 *  pages stays in memory on a shared tablet. */
export async function logout(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
}
