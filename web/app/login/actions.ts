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

  // redirect() throws, so it must be outside any try/catch.
  // Always Home after signing in: never a "next" or last-visited page.
  redirect("/home");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
