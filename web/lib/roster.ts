// Pure helpers for rosters: week dates, the shift form check, totals,
// warning text, "next shift", and comparing timesheets with the roster.
// No React, no Supabase, so they run under `node --test`.
//
// The database is the real guard (roster_shifts_before_write, the
// no-overlap constraint, RLS). It also works out breaks and paid minutes
// with nz_breaks(), and finds the warnings (roster_warnings).

import { MAX_SHIFT_MINUTES, minutesBetween } from "./breaks.ts";
import { weekStart } from "./hours.ts";
import { isYmd, shortYmd } from "./leave.ts";

/** More paid hours than this in a week gives a warning. Same number as
 *  over_hours_limit in roster_warnings() (the rosters migration); a test
 *  reads that line, so change both. */
export const OVER_HOURS_LIMIT = 40;

/** A clock-in or clock-out more than this far from the roster is flagged. */
export const DIFFERENCE_MINUTES = 15;

export const POSITION_SUGGESTIONS = ["Kitchen", "Front", "Barista", "Driver", "Prep"];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---- Week dates ----------------------------------------------------------------------

/** "2026-11-20" plus n days. Works on the date itself, so daylight saving
 *  can't skip or repeat a day. */
export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The 7 dates of the week starting on this Monday. */
export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** ?week= from the URL -> its Monday; anything invalid -> this week's Monday. */
export function weekFromParam(value: string | undefined, today: string): string {
  return value && isYmd(value) ? weekStart(value) : weekStart(today);
}

/** "Mon 16 Nov to Sun 22 Nov" */
export function weekRangeText(monday: string): string {
  return `${shortYmd(monday)} to ${shortYmd(addDays(monday, 6))}`;
}

// ---- The shift form --------------------------------------------------------------------

export type ShiftInput = {
  staff_id: string;
  work_date: string;
  start_time: string;
  finish_time: string;
  position: string;
  note: string;
};

export type ShiftValues = {
  staff_id: string;
  work_date: string;
  start_time: string;
  finish_time: string;
  position: string | null;
  note: string | null;
};

/** Check the "Add shift" form for the week starting `monday`. */
export function validateShift(
  input: ShiftInput,
  monday: string,
): { values: ShiftValues | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const position = input.position.trim();
  const note = input.note.trim();

  if (!UUID_RE.test(input.staff_id)) errors.staff_id = "Who is working?";
  if (!weekDays(monday).includes(input.work_date)) errors.work_date = "Pick a day in this week";

  const minutes = minutesBetween(input.start_time, input.finish_time);
  if (!input.start_time) errors.start_time = "When do they start?";
  if (!input.finish_time) errors.finish_time = "When do they finish?";
  else if (input.start_time && minutes === null) errors.finish_time = "The finish time must be after the start time";
  else if (minutes !== null && minutes > MAX_SHIFT_MINUTES) errors.finish_time = "That's more than 16 hours";

  if (position.length > 40) errors.position = "Keep it under 40 characters";
  if (note.length > 200) errors.note = "Keep it under 200 characters";

  if (Object.keys(errors).length > 0) return { values: null, errors };
  return {
    values: {
      staff_id: input.staff_id,
      work_date: input.work_date,
      start_time: input.start_time,
      finish_time: input.finish_time,
      position: position || null,
      note: note || null,
    },
    errors,
  };
}

// ---- The week view -------------------------------------------------------------------

export type RosterShiftLite = {
  id: string;
  staff_id: string;
  staff_name: string;
  work_date: string;
  start_time: string; // "09:00:00"
  finish_time: string;
  paid_minutes: number;
};

/** One section per day of the week (empty days too), shifts by start time. */
export function groupByDay<S extends RosterShiftLite>(shifts: S[], monday: string): { date: string; shifts: S[] }[] {
  return weekDays(monday).map((date) => ({
    date,
    shifts: shifts
      .filter((s) => s.work_date === date)
      .sort((a, b) => a.start_time.localeCompare(b.start_time) || a.staff_name.localeCompare(b.staff_name)),
  }));
}

export type PersonTotal = { staffId: string; name: string; paidMinutes: number; shifts: number };

/** Rostered paid minutes per person (by name) and for everyone. */
export function rosterTotals(shifts: RosterShiftLite[]): { people: PersonTotal[]; paidMinutes: number } {
  const byPerson = new Map<string, PersonTotal>();
  for (const s of shifts) {
    const t = byPerson.get(s.staff_id) ?? { staffId: s.staff_id, name: s.staff_name, paidMinutes: 0, shifts: 0 };
    t.paidMinutes += s.paid_minutes;
    t.shifts += 1;
    byPerson.set(s.staff_id, t);
  }
  const people = [...byPerson.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { people, paidMinutes: people.reduce((sum, p) => sum + p.paidMinutes, 0) };
}

export type WeekState = "draft" | "published" | "changed";

/** Not published yet, published, or changed since it was published. */
export function weekState(week: { published_at: string | null; changed_at: string | null } | null): WeekState {
  if (!week?.published_at) return "draft";
  return week.changed_at ? "changed" : "published";
}

// ---- Warnings ----------------------------------------------------------------------------

/** A row from roster_warnings(). */
export type RosterWarning = {
  kind: "leave" | "over_hours";
  staff_id: string;
  staff_name: string;
  work_date: string | null;
  shift_id: string | null;
  paid_minutes: number;
};

/** "Ana is on approved leave on Wed 9 Jan" / "Ana has 42.5 h rostered this week (over 40)" */
export function warningText(w: RosterWarning): string {
  if (w.kind === "leave") return `${w.staff_name} is on approved leave${w.work_date ? ` on ${shortYmd(w.work_date)}` : ""}`;
  return `${w.staff_name} has ${minutesAsHours(w.paid_minutes)} h paid rostered this week, across all sites (over ${OVER_HOURS_LIMIT})`;
}

/** Leave warnings by shift id, and the week-wide ones (over 40 hours). */
export function splitWarnings(warnings: RosterWarning[]): { byShift: Map<string, RosterWarning[]>; week: RosterWarning[] } {
  const byShift = new Map<string, RosterWarning[]>();
  const week: RosterWarning[] = [];
  for (const w of warnings) {
    if (w.shift_id) byShift.set(w.shift_id, [...(byShift.get(w.shift_id) ?? []), w]);
    else week.push(w);
  }
  week.sort((a, b) => a.staff_name.localeCompare(b.staff_name));
  return { byShift, week };
}

function minutesAsHours(minutes: number): string {
  return String(Number((minutes / 60).toFixed(2)));
}

// ---- Staff: my shifts ----------------------------------------------------------------------

/** The first shift that hasn't finished yet (the one "up next" or on now). */
export function nextShift<S extends { start_at: string; finish_at: string }>(shifts: S[], now: Date): S | null {
  const upcoming = shifts
    .filter((s) => Date.parse(s.finish_at) > now.getTime())
    .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
  return upcoming[0] ?? null;
}

/** "09:00:00" -> "9:00 am"; "17:30:00" -> "5:30 pm". */
export function clockText(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const suffix = h < 12 ? "am" : "pm";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** "9:00 am to 5:00 pm", with "(next day)" when it runs past midnight. */
export function shiftTimesText(s: { start_time: string; finish_time: string }): string {
  const nextDay = s.finish_time < s.start_time ? " (next day)" : "";
  return `${clockText(s.start_time)} to ${clockText(s.finish_time)}${nextDay}`;
}

// ---- Timesheets vs the roster --------------------------------------------------------------

export type RosteredForCompare = {
  staff_id: string;
  site_id: string;
  work_date: string;
  start_time: string;
  finish_time: string;
  start_at: string;
  finish_at: string;
};

export type TimesheetForCompare = {
  staff_id: string;
  site_id: string;
  work_date: string;
  start_at: string;
  finish_at: string;
};

export type RosterComparison<R extends RosteredForCompare = RosteredForCompare> =
  | { status: "not_rostered" }
  | { status: "matches"; shift: R }
  /** startLate: minutes after the rostered start (negative = early);
   *  finishLate: minutes after the rostered finish (negative = early). */
  | { status: "differs"; shift: R; startLate: number; finishLate: number };

const minutesApart = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 60_000);

/** Find the rostered shift for the same person, day and site (the one
 *  starting closest to the timesheet, if they had a split shift) and flag
 *  a start or finish more than 15 minutes away from it. */
export function compareToRoster<R extends RosteredForCompare>(
  timesheet: TimesheetForCompare,
  rostered: R[],
): RosterComparison<R> {
  const candidates = rostered.filter(
    (r) => r.staff_id === timesheet.staff_id && r.site_id === timesheet.site_id && r.work_date === timesheet.work_date,
  );
  if (candidates.length === 0) return { status: "not_rostered" };
  const shift = candidates.reduce((best, r) =>
    Math.abs(minutesApart(timesheet.start_at, r.start_at)) < Math.abs(minutesApart(timesheet.start_at, best.start_at))
      ? r
      : best,
  );
  const startLate = minutesApart(timesheet.start_at, shift.start_at);
  const finishLate = minutesApart(timesheet.finish_at, shift.finish_at);
  if (Math.abs(startLate) > DIFFERENCE_MINUTES || Math.abs(finishLate) > DIFFERENCE_MINUTES) {
    return { status: "differs", shift, startLate, finishLate };
  }
  return { status: "matches", shift };
}

/** 75 -> "1 h 15 min", 20 -> "20 min". */
export function durationText(minutes: number): string {
  const m = Math.abs(minutes);
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return `${rest} min`;
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`;
}

/** The differences, e.g. ["Started 20 min late", "Finished 1 h early"]. Only
 *  those over 15 minutes. */
export function differenceTexts(c: RosterComparison): string[] {
  if (c.status !== "differs") return [];
  const texts: string[] = [];
  if (Math.abs(c.startLate) > DIFFERENCE_MINUTES) {
    texts.push(`Started ${durationText(c.startLate)} ${c.startLate > 0 ? "late" : "early"}`);
  }
  if (Math.abs(c.finishLate) > DIFFERENCE_MINUTES) {
    texts.push(`Finished ${durationText(c.finishLate)} ${c.finishLate > 0 ? "late" : "early"}`);
  }
  return texts;
}
