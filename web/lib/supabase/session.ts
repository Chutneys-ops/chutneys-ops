// Who is signed in, and where are they working right now?
// Server-only helpers used by the pages under app/(app).

import { redirect } from "next/navigation";
import { STALE_HOURS } from "@/lib/hours";
import type { Role } from "@/lib/staff";
import type { createClient } from "./server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type { Role };
export type Me = { id: string; name: string; role: Role; active: boolean };
export type SiteSummary = { id: string; name: string; kind: string };
export type CurrentShift = { id: string; clock_in: string; site: SiteSummary };

/** Where a turned-off person is sent: it signs them out and says why. */
export const DEACTIVATED_SIGNOUT_PATH = "/auth/signout";
/** Where two-step sign-in happens: set up an authenticator, or type the code. */
export const MFA_PATH = "/mfa";

/** What two-step sign-in still needs (mfa_status() in the database):
 *  "enrol"  - an owner or manager with no authenticator yet;
 *  "verify" - has one, signed in with only a password so far;
 *  "none"   - nothing to do. */
export type MfaStep = "none" | "enrol" | "verify";

export type SessionInfo = { userId: string | null; me: Me | null; mfa: MfaStep };

function mfaStep(value: unknown): MfaStep {
  return value === "enrol" || value === "verify" ? value : "none";
}

/** Like getSession, but never redirects. /auth/signout and /mfa use it. */
export async function readSession(supabase: Supabase): Promise<SessionInfo> {
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub ?? null;
  if (!userId) return { userId: null, me: null, mfa: "none" };
  // You can always read your own staff row (RLS "see self or owner"), even
  // when your account is turned off (the "active accounts only" exception)
  // or you still need to type your two-step code.
  const [{ data }, { data: mfa }] = await Promise.all([
    supabase.from("staff").select("id, name, role, active").eq("id", userId).maybeSingle(),
    supabase.rpc("mfa_status"),
  ]);
  return { userId, me: (data as Me | null) ?? null, mfa: mfaStep(mfa) };
}

/** userId is null when signed out. me is null when the login has no staff row.
 *  - A turned-off person (staff.active = false) whose token hasn't expired
 *    yet is sent to sign out.
 *  - Anyone who still needs two-step sign-in (an owner or manager without an
 *    authenticator, or anyone with one who hasn't typed the code) is sent to
 *    /mfa.
 *  Every signed-in page calls this, so it happens on their next page load.
 *  (The database already holds them to staff-level or nothing.) */
export async function getSession(supabase: Supabase): Promise<SessionInfo> {
  const session = await readSession(supabase);
  if (session.me && !session.me.active) redirect(DEACTIVATED_SIGNOUT_PATH);
  if (session.me && session.mfa !== "none") redirect(MFA_PATH);
  return session;
}

export function isManager(me: Me): boolean {
  return me.role === "manager" || me.role === "owner";
}

async function getOpenShift(supabase: Supabase, userId: string) {
  const { data } = await supabase
    .from("shifts")
    .select("id, clock_in, site:sites(id, name, kind)")
    .eq("staff_id", userId)
    .is("clock_out", null)
    .maybeSingle();
  return data as unknown as { id: string; clock_in: string; site: SiteSummary | null } | null;
}

function isStale(clockIn: string): boolean {
  return Date.now() - new Date(clockIn).getTime() > STALE_HOURS * 60 * 60 * 1000;
}

/** Today's site choice ("Choose site"): your open row in shifts, with its
 *  site. There is at most one (a partial unique index). A choice older than
 *  14 hours doesn't count (on_shift_at in the database agrees), so you
 *  choose again each day and the header never shows a site your entries
 *  would be refused at. */
export async function getCurrentShift(supabase: Supabase, userId: string): Promise<CurrentShift | null> {
  const shift = await getOpenShift(supabase, userId);
  // A site closed while you were on shift: treat it as not clocked in.
  if (!shift?.site || isStale(shift.clock_in)) return null;
  return { id: shift.id, clock_in: shift.clock_in, site: shift.site };
}

/** "truck" -> "Food truck", for the site picker and header. */
export function kindLabel(kind: string): string {
  if (kind === "truck") return "Food truck";
  if (kind === "cafe") return "Cafe";
  if (kind === "restaurant") return "Restaurant";
  return kind;
}
