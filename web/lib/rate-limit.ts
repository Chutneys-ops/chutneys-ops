// The app's rate limits: how many tries each action allows, how keys are
// built, and the message people see. The counting itself is
// check_rate_limit() in the database (supabase/migrations/
// 20261210000000_rate_limits.sql); lib/supabase/rate-limit.ts calls it.
//
// Pure functions, so they can be unit tested without a database.

import { createHash } from "node:crypto";

export type Limit = { max: number; windowSeconds: number };

/** Per person unless it says per IP. Generous enough for a real busy day,
 *  tight enough that a script hammering the action is stopped quickly. */
export const LIMITS = {
  /** Owner: invites and resent invites (each sends an email). */
  invite: { max: 20, windowSeconds: 60 * 60 },
  /** Owner: resetting someone's two-step sign-in. */
  mfaReset: { max: 10, windowSeconds: 60 * 60 },
  /** Signing off a sheet with a PIN (on top of the 5-wrong-PINs lock). */
  pinSignOff: { max: 15, windowSeconds: 15 * 60 },
  /** Typing a two-step code: 6 digits, so guesses must stay few. */
  mfaVerify: { max: 10, windowSeconds: 15 * 60 },
  /** Starting to set up an authenticator (makes a new secret each time). */
  mfaEnrol: { max: 10, windowSeconds: 60 * 60 },
  /** Saving a purchase (with its invoice upload). */
  purchase: { max: 30, windowSeconds: 60 * 60 },
  /** Asking for leave (with a certificate upload). */
  leave: { max: 10, windowSeconds: 60 * 60 },
  /** Owner: payslip PDFs. A pay run uploads one per person at once. */
  payslipUpload: { max: 300, windowSeconds: 60 * 60 },
  /** Per IP: the scheduled routes (pg_cron calls every 5 minutes). */
  cron: { max: 30, windowSeconds: 5 * 60 },
} as const satisfies Record<string, Limit>;

export type LimitName = keyof typeof LIMITS;

export type RateResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number; message: string };

/** 'user:<id>:<action>'. The database refuses any other id than yours. */
export function userKey(userId: string, action: LimitName): string {
  return `user:${userId}:${action}`;
}

/** The IP is hashed, so no raw address is stored (or copied into the
 *  audit log). Same IP, same hash; the hash can't be turned back. */
export function hashIp(ip: string): string {
  return createHash("sha256").update(`chutneys-rate-limit:${ip}`).digest("hex").slice(0, 32);
}

/** 'ip:<hash>:<action>'. Only the server (secret key) may use these. */
export function ipKey(ip: string, action: LimitName): string {
  return `ip:${hashIp(ip)}:${action}`;
}

/** The caller's IP. Hosts (Vercel, Netlify) put the real one first in
 *  x-forwarded-for. Without any header (local dev), everyone is "unknown",
 *  which just means one shared allowance. */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  return headers.get("x-real-ip")?.trim() || "unknown";
}

/** "Too many attempts, try again in 3 minutes". Always at least 1 minute,
 *  rounded up, so people never come back too early. */
export function tooManyMessage(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Too many attempts, try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
}

/** check_rate_limit() answers {"allowed": true, "remaining": n} or
 *  {"allowed": false, "retry_after_seconds": n}. Anything else (an error,
 *  a surprise shape) counts as refused: when in doubt, don't let it through. */
export function readRateResult(data: unknown): RateResult {
  const row = data as { allowed?: unknown; retry_after_seconds?: unknown } | null;
  if (row?.allowed === true) return { allowed: true };
  const retry = typeof row?.retry_after_seconds === "number" && row.retry_after_seconds > 0 ? row.retry_after_seconds : 60;
  return { allowed: false, retryAfterSeconds: retry, message: tooManyMessage(retry) };
}
