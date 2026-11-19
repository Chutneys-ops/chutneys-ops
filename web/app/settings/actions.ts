"use server";

// Set your sign-off PIN. set_my_pin (security definer) checks that you are a
// manager or owner and that the PIN is 4 digits, then stores only a bcrypt hash.

import { createClient } from "@/lib/supabase/server";

export type PinState = { seq: number; ok?: boolean; message?: string };

export async function setPin(prev: PinState, formData: FormData): Promise<PinState> {
  const seq = prev.seq + 1;
  const pin = String(formData.get("pin") ?? "").trim();
  const confirm = String(formData.get("confirm") ?? "").trim();

  if (!/^\d{4}$/.test(pin)) return { seq, message: "The PIN must be 4 digits." };
  if (pin !== confirm) return { seq, message: "The two PINs don't match." };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return { seq, message: "You are signed out. Sign in again." };

  const { error } = await supabase.rpc("set_my_pin", { pin });
  if (error) {
    // 42501: not a manager or owner. 22023: not 4 digits. Both read well.
    const readable = error.code === "42501" || error.code === "22023";
    return { seq, message: readable ? error.message : `Could not save your PIN: ${error.message}` };
  }
  return { seq, ok: true, message: "PIN saved. Use it to sign off records." };
}
