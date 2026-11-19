// Shift hours maths for /time. Pure functions: no React, no Supabase.
//
// A shift's length is just clock_out minus clock_in, as instants in time, so
// a shift that crosses midnight (10 pm to 2 am) is simply 4 hours. Which
// *day* or *week* a shift belongs to is decided by its clock_in, in Auckland.

import { aucklandDate } from "./dates.ts";

export type ShiftTimes = { clock_in: string; clock_out: string | null };

const MINUTE = 60_000;

/** Whole minutes worked. An open shift counts up to `now`. Never negative. */
export function shiftMinutes(shift: ShiftTimes, now: Date = new Date()): number {
  const start = new Date(shift.clock_in).getTime();
  const end = shift.clock_out ? new Date(shift.clock_out).getTime() : now.getTime();
  return Math.max(0, Math.floor((end - start) / MINUTE));
}

/** Total minutes over several shifts. */
export function totalMinutes(shifts: ShiftTimes[], now: Date = new Date()): number {
  return shifts.reduce((sum, shift) => sum + shiftMinutes(shift, now), 0);
}

/** "7 h 5 min", "45 min", "8 h", "0 min". */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

/** The Monday on or before a "YYYY-MM-DD" date (weeks run Monday to Sunday). */
export function weekStart(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  const daysSinceMonday = (d.getUTCDay() + 6) % 7; // Sunday is 0 in JS
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  return d.toISOString().slice(0, 10);
}

/** Shifts that started this week (Auckland time), given today's Auckland date. */
export function shiftsThisWeek<S extends ShiftTimes>(shifts: S[], today: string): S[] {
  const monday = weekStart(today);
  return shifts.filter((s) => aucklandDate(new Date(s.clock_in)) >= monday);
}

/** True when a closed shift ends on a later Auckland day than it started. */
export function crossesMidnight(shift: ShiftTimes): boolean {
  if (!shift.clock_out) return false;
  return aucklandDate(new Date(shift.clock_out)) > aucklandDate(new Date(shift.clock_in));
}
