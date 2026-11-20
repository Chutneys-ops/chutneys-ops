// Two-step sign-in (authenticator app codes): the small rules shared by the
// /mfa screen and Settings > Two-step sign-in. Pure, so they're unit tested.
//
// The real enforcement is in the database: is_owner() and is_manager() need
// a token that came with a code (aal2). See
// supabase/migrations/20261209000000_two_factor.sql.

/** How many devices we suggest: a phone plus one spare (a second phone, a
 *  tablet, or a password manager that holds codes). */
export const RECOMMENDED_DEVICES = 2;

/** "123 456", "123-456" or " 123456 " -> "123456". null if it isn't 6 digits. */
export function cleanCode(input: string): string | null {
  const digits = input.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}

/** The setup key in groups of four, easier to type by hand:
 *  "JBSWY3DPEHPK3PXP" -> "JBSW Y3DP EHPK 3PXP". */
export function groupSecret(secret: string): string {
  return secret.replace(/\s/g, "").replace(/(.{4})(?=.)/g, "$1 ");
}

/** Supabase gives the QR code as "data:image/svg+xml;utf-8,<svg …>" with the
 *  SVG not escaped (quotes, #). Escape it so it's a valid image URL. A raw
 *  "<svg" is handled too. Anything else is refused (null). */
export function qrDataUrl(qr: string): string | null {
  const svgStart = qr.indexOf("<svg");
  if (svgStart === -1 || (svgStart > 0 && !qr.startsWith("data:image/svg+xml"))) return null;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr.slice(svgStart))}`;
}

/** A device's name, as shown in Settings. Blank gets a default. */
export function deviceName(input: string, existingCount: number): { ok: true; name: string } | { ok: false; error: string } {
  const name = input.trim().replace(/\s+/g, " ");
  if (!name) return { ok: true, name: existingCount === 0 ? "My phone" : `Device ${existingCount + 1}` };
  if (name.length > 40) return { ok: false, error: "Keep the device name to 40 characters." };
  return { ok: true, name };
}

/** Supabase Auth's error codes, in words people can act on. */
export function mfaErrorMessage(code: string | undefined, fallback: string): string {
  switch (code) {
    case "mfa_verification_failed":
    case "mfa_verification_rejected":
      return "That code didn't work. Use the newest code in your app, and check your phone's clock is set automatically.";
    case "mfa_challenge_expired":
      return "That took too long. Type the newest code from your app.";
    case "mfa_factor_name_conflict":
      return "You already have a device with that name. Choose another name.";
    case "insufficient_aal":
      return "Type your code from your existing device first, then add another.";
    case "too_many_enrolled_mfa_factors":
      return "You already have the most devices allowed. Remove one first.";
    case "over_request_rate_limit":
      return "Too many attempts, try again in a few minutes.";
    case "mfa_totp_enroll_not_enabled":
    case "mfa_totp_verify_not_enabled":
      return "Two-step sign-in isn't switched on for this app yet. Tell the owner (see docs/RUNBOOK.md).";
    default:
      return fallback;
  }
}

/** Advice under the device list: nudge towards a second device. */
export function deviceAdvice(count: number, isManagerRole: boolean): string | null {
  if (count === 0) return null;
  if (count < RECOMMENDED_DEVICES) {
    return isManagerRole
      ? "Add a second device (a spare phone or tablet). If you lose your only one, you can't do manager work until the owner resets it."
      : "Add a second device (a spare phone or tablet), so losing your phone doesn't lock you out.";
  }
  return null;
}

/** What removing a device leads to, said before it happens. */
export function removeWarning(remaining: number, isManagerRole: boolean): string {
  if (remaining > 0) return "You can still sign in with your other device.";
  return isManagerRole
    ? "It's your last one: as a manager you'll set up a new device straight away."
    : "It's your last one: two-step sign-in will be off.";
}
