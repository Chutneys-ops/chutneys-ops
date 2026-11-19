// Who is signed in, and where are they working right now?
// Server-only helpers used by the pages under app/(app).

import { STALE_HOURS } from "@/lib/hours";
import type { createClient } from "./server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type Role = "staff" | "manager" | "owner";
export type Me = { id: string; name: string; role: Role };
export type SiteSummary = { id: string; name: string; kind: string };
export type CurrentShift = { id: string; clock_in: string; site: SiteSummary };

/** userId is null when signed out. me is null when the login has no staff row. */
export async function getSession(supabase: Supabase): Promise<{ userId: string | null; me: Me | null }> {
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub ?? null;
  if (!userId) return { userId: null, me: null };
  // You can always read your own staff row (RLS "see self or owner").
  const { data } = await supabase.from("staff").select("id, name, role").eq("id", userId).maybeSingle();
  return { userId, me: (data as Me | null) ?? null };
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

/** Your open shift (clock_out is null), with its site. There is at most one:
 *  a partial unique index in the database guarantees it. A shift open for
 *  more than 14 hours doesn't count (on_shift_at in the database agrees), so
 *  the header never says "Working at X" when your entries would be refused. */
export async function getCurrentShift(supabase: Supabase, userId: string): Promise<CurrentShift | null> {
  const shift = await getOpenShift(supabase, userId);
  // A site closed while you were on shift: treat it as not clocked in.
  if (!shift?.site || isStale(shift.clock_in)) return null;
  return { id: shift.id, clock_in: shift.clock_in, site: shift.site };
}

/** An open shift older than 14 hours: you forgot to clock out. start_shift
 *  will close it with zero hours for a manager to fix. */
export async function getForgottenShift(
  supabase: Supabase,
  userId: string,
): Promise<{ clock_in: string; siteName: string } | null> {
  const shift = await getOpenShift(supabase, userId);
  if (!shift || !isStale(shift.clock_in)) return null;
  return { clock_in: shift.clock_in, siteName: shift.site?.name ?? "a closed site" };
}

/** "truck" -> "Food truck", for the site picker and header. */
export function kindLabel(kind: string): string {
  if (kind === "truck") return "Food truck";
  if (kind === "cafe") return "Cafe";
  if (kind === "restaurant") return "Restaurant";
  return kind;
}
