// Server-side loading for rosters, shared by /roster, /time and Home. Every
// query runs as the signed-in person, so RLS decides what comes back: staff
// get only their own shifts in published weeks. The rules live in
// lib/roster.ts (tested).

import type { RosterWarning } from "@/lib/roster";
import type { createClient } from "./server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type Coworker = { name: string; start_time: string; finish_time: string };

export type MyShift = {
  id: string;
  site_id: string;
  work_date: string;
  start_time: string;
  finish_time: string;
  start_at: string;
  finish_at: string;
  paid_minutes: number;
  position: string | null;
  note: string | null;
  site: { name: string } | null;
  /** Others rostered at the same site that day (names and times only). */
  coworkers: Coworker[];
};

/** Your shifts in published weeks between two dates (inclusive), each with
 *  "who's on with me" from roster_coworkers(). */
export async function loadMyShifts(
  supabase: Supabase,
  userId: string,
  from: string,
  to: string,
): Promise<{ shifts: MyShift[]; error: string | null }> {
  const [shiftsResult, coworkersResult] = await Promise.all([
    supabase
      .from("roster_shifts")
      .select(
        "id, site_id, work_date, start_time, finish_time, start_at, finish_at, paid_minutes, position, note, site:sites(name)",
      )
      .eq("staff_id", userId)
      .gte("work_date", from)
      .lte("work_date", to)
      .order("start_at"),
    supabase.rpc("roster_coworkers", { from_date: from, to_date: to }),
  ]);
  const error = shiftsResult.error ?? coworkersResult.error;
  const byShift = new Map<string, Coworker[]>();
  for (const c of (coworkersResult.data ?? []) as (Coworker & { my_shift_id: string })[]) {
    byShift.set(c.my_shift_id, [
      ...(byShift.get(c.my_shift_id) ?? []),
      { name: c.name, start_time: c.start_time, finish_time: c.finish_time },
    ]);
  }
  const shifts = ((shiftsResult.data ?? []) as unknown as Omit<MyShift, "coworkers">[]).map((s) => ({
    ...s,
    coworkers: byShift.get(s.id) ?? [],
  }));
  return { shifts, error: error ? error.message : null };
}

/** roster_warnings() for a week (managers only; empty for no week). */
export async function loadWarnings(supabase: Supabase, weekId: string | null): Promise<RosterWarning[]> {
  if (!weekId) return [];
  const { data } = await supabase.rpc("roster_warnings", { week_id: weekId });
  return (data ?? []) as RosterWarning[];
}
