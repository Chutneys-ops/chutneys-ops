"use server";

import { looksLikeEmail, normaliseEmail } from "@/lib/staff";
import { requestOrigin } from "@/lib/request-origin";
import { createClient } from "@/lib/supabase/server";

export type ForgotState = { sent: boolean; error: string | null };

// Always { sent: true } for a valid-looking email, whether or not it has an
// account, so nobody can use this form to find out who works here. Supabase
// Auth behaves the same way: "OK" for unknown emails, and nothing is sent.
export async function requestReset(_prev: ForgotState, formData: FormData): Promise<ForgotState> {
  const email = normaliseEmail(String(formData.get("email") ?? ""));
  if (!looksLikeEmail(email)) return { sent: false, error: "Enter your work email address." };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${await requestOrigin()}/auth/confirm`,
  });
  // Errors (for example too many requests) are logged for us, not shown:
  // showing them would differ between real and unknown emails.
  if (error) console.error("resetPasswordForEmail failed:", error.code ?? error.message);

  return { sent: true, error: null };
}
