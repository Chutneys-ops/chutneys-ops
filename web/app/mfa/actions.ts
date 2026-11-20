"use server";

// Two-step sign-in: set up an authenticator, type its code, remove one.
// Used by /mfa (right after signing in) and Settings > Two-step sign-in.
//
// Everything runs on the server with the person's own session, so the new
// aal2 token lands in their cookies, and each code attempt is rate limited
// here before Supabase Auth sees it.

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { cleanCode, deviceName, mfaErrorMessage, qrDataUrl } from "@/lib/mfa";
import { limitPerson } from "@/lib/supabase/rate-limit";
import { createClient } from "@/lib/supabase/server";

export type EnrolStart =
  | { ok: true; factorId: string; qr: string; secret: string; name: string }
  | { ok: false; message: string };
export type CodeState = { seq: number; ok?: boolean; message?: string };

// Where a successful code may send you. Never a URL from the form as is.
const NEXT_PAGES = new Set(["/home", "/settings?twostep=added#two-step", "/settings#two-step"]);

async function signedIn() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub ?? null;
  return { supabase, userId };
}

/** Step 1 of setting up: a new secret, shown as a QR code and as text. */
export async function startEnrol(formData: FormData): Promise<EnrolStart> {
  const { supabase, userId } = await signedIn();
  if (!userId) return { ok: false, message: "You are signed out. Sign in again." };

  const limit = await limitPerson(supabase, userId, "mfaEnrol");
  if (!limit.allowed) return { ok: false, message: limit.message };

  const { data: factors } = await supabase.auth.mfa.listFactors();
  // A setup that was started but never finished (closed the page): remove
  // it, so it doesn't use up a slot or a name.
  for (const f of factors?.all ?? []) {
    if (f.factor_type === "totp" && f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
  }

  const named = deviceName(String(formData.get("name") ?? ""), factors?.totp.length ?? 0);
  if (!named.ok) return { ok: false, message: named.error };

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: named.name,
    issuer: "Chutneys Ops",
  });
  if (error || !data) {
    return { ok: false, message: mfaErrorMessage(error?.code, `Could not start: ${error?.message ?? "no answer"}`) };
  }
  const qr = qrDataUrl(data.totp.qr_code);
  if (!qr) return { ok: false, message: "Could not draw the QR code. Use the setup key instead." };
  return { ok: true, factorId: data.id, qr, secret: data.totp.secret, name: named.name };
}

/** Step 2 of setting up, and every sign-in after: check a 6-digit code.
 *  With factorId (just set up) it checks that device; without, it tries
 *  each device you have (people don't know which one they're holding). */
export async function verifyCode(prev: CodeState, formData: FormData): Promise<CodeState> {
  const seq = prev.seq + 1;
  const code = cleanCode(String(formData.get("code") ?? ""));
  if (!code) return { seq, message: "Type the 6-digit code from your authenticator app." };

  const { supabase, userId } = await signedIn();
  if (!userId) return { seq, message: "You are signed out. Sign in again." };

  const limit = await limitPerson(supabase, userId, "mfaVerify");
  if (!limit.allowed) return { seq, message: limit.message };

  const given = String(formData.get("factorId") ?? "");
  let factorIds: string[];
  if (given) {
    factorIds = [given];
  } else {
    const { data: factors } = await supabase.auth.mfa.listFactors();
    factorIds = (factors?.totp ?? []).map((f) => f.id);
  }
  if (factorIds.length === 0) return { seq, message: "You have no authenticator set up yet." };

  let lastError: { code?: string; message: string } | null = null;
  for (const factorId of factorIds) {
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    if (!error) {
      lastError = null;
      break;
    }
    lastError = error;
  }
  if (lastError) return { seq, message: mfaErrorMessage(lastError.code, `Could not check the code: ${lastError.message}`) };

  const next = String(formData.get("next") ?? "/home");
  // redirect() throws, so it stays outside any try/catch.
  redirect(NEXT_PAGES.has(next) ? next : "/home");
}

/** Settings: remove one of your devices. Supabase Auth only allows it with
 *  a code-checked (aal2) session. */
export async function removeDevice(prev: CodeState, formData: FormData): Promise<CodeState> {
  const seq = prev.seq + 1;
  const { supabase, userId } = await signedIn();
  if (!userId) return { seq, message: "You are signed out. Sign in again." };

  const factorId = String(formData.get("factorId") ?? "");
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const device = factors?.totp.find((f) => f.id === factorId);
  if (!device) return { seq, message: "That device isn't one of yours." };

  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) return { seq, message: mfaErrorMessage(error.code, `Could not remove it: ${error.message}`) };

  refresh();
  return { seq, ok: true, message: `Removed ${device.friendly_name ?? "the device"}.` };
}
