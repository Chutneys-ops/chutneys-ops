"use server";

// Settings > Change password. Supabase Auth checks the current password
// itself (require_current_password in supabase/config.toml), so a stolen
// unlocked phone can't quietly change it.

import { authErrorMessage, changePasswordProblem } from "@/lib/passwords";
import { createClient } from "@/lib/supabase/server";

export type ChangePasswordState = { seq: number; ok?: boolean; message?: string };

export async function changePassword(prev: ChangePasswordState, formData: FormData): Promise<ChangePasswordState> {
  const seq = prev.seq + 1;
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("password") ?? "");

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) return { seq, message: "You are signed out. Sign in again." };
  const email = typeof data.claims.email === "string" ? data.claims.email : null;

  const problem = changePasswordProblem(current, next, email);
  if (problem) return { seq, message: problem };

  const { error } = await supabase.auth.updateUser({ password: next, current_password: current });
  if (error) return { seq, message: authErrorMessage(error.code, `Could not change your password: ${error.message}`) };
  return { seq, ok: true, message: "Password changed. Use the new one next time you sign in." };
}
