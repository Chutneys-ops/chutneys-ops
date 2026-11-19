// Shift hours maths for /time. Pure functions: no React, no Supabase.
//
// A shift's length is just clock_out minus clock_in, as instants in time, so
// a shift that crosses midnight (10 pm to 2 am) is simply 4 hours. Which
// *day* or *week* a shift belongs to is decided by its clock_in, in Auckland.

import { aucklandDate } from "./dates.ts";

export type ShiftTimes = { clock_in: string; clock_out: string | null };

const MINUTE = 60_000;

/** An open shift older than this is a forgotten clock-out. Matches
 *  stale_shift_cutoff() in the database (now() - 14 hours). */
export const STALE_HOURS = 14;

/** True for an open shift that started more than STALE_HOURS ago. */
export function isStaleOpen(shift: ShiftTimes, now: Date = new Date()): boolean {
  return !shift.clock_out && now.getTime() - new Date(shift.clock_in).getTime() > STALE_HOURS * 60 * MINUTE;
}

/** Whole minutes worked. An open shift counts up to `now`, unless it's stale
 *  (a forgotten clock-out): that counts 0 until a manager fixes it, the same
 *  "no invented hours" rule as the database. Never negative. */
export function shiftMinutes(shift: ShiftTimes, now: Date = new Date()): number {
  if (isStaleOpen(shift, now)) return 0;
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

// ---- Auckland wall-clock time <-> UTC ------------------------------------
//
// A manager types "5:30 pm on the 20th" meaning Auckland time. The database
// stores an instant (timestamptz), so the server must turn that wall-clock
// time into UTC. Auckland is UTC+13 in summer (NZDT) and UTC+12 in winter
// (NZST), so the offset depends on the date itself.

const wallClock = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Pacific/Auckland",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** An instant as Auckland "YYYY-MM-DDTHH:mm", the format of <input type="datetime-local">. */
export function toAucklandLocalInput(value: string | Date): string {
  const parts = Object.fromEntries(
    wallClock.formatToParts(new Date(value)).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** How far Auckland is ahead of UTC at this instant, in milliseconds. */
function aucklandOffsetMs(instant: number): number {
  const asIfUtc = Date.parse(`${toAucklandLocalInput(new Date(instant))}:00Z`);
  // Drop seconds and milliseconds from the instant so the two line up.
  return asIfUtc - Math.floor(instant / MINUTE) * MINUTE;
}

/**
 * Auckland "YYYY-MM-DDTHH:mm" -> the UTC instant, or null if it isn't a
 * valid date and time. Guess the offset, then check it at the guessed
 * instant once more, which handles the days the clocks change.
 */
export function aucklandLocalToUtc(local: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) return null;
  const asIfUtc = Date.parse(`${local}:00Z`);
  if (Number.isNaN(asIfUtc) || new Date(asIfUtc).toISOString().slice(0, 16) !== local) return null;
  let instant = asIfUtc - aucklandOffsetMs(asIfUtc);
  instant = asIfUtc - aucklandOffsetMs(instant);
  return new Date(instant);
}
