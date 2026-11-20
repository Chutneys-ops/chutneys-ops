// NZ rest and meal breaks, the same table as nz_breaks() in the database
// (supabase/migrations/20261127000000_timesheets.sql). The database is what
// counts; this copy drives the live preview on the hours form.
//
// Employment NZ: rest breaks are 10 minutes and paid, meal breaks are 30
// minutes and unpaid.
//   under 2h: 0/0   2-4h: 1/0   >4-6h: 1/1   >6-10h: 2/1
//   >10-12h: 3/1    >12-14h: 3/2   >14-16h: 4/2
//
// web/lib/breaks.test.ts checks this against the cases in
// supabase/tests/nz_breaks.test.sql, which also tests the SQL, so the two
// can't drift apart without a test failing.

export const REST_BREAK_MINUTES = 10;
export const MEAL_BREAK_MINUTES = 30;
export const MAX_SHIFT_MINUTES = 16 * 60;

export type Breaks = { rest: number; meal: number };

export function nzBreaks(minutesAtWork: number): Breaks {
  const m = Math.max(0, minutesAtWork);
  let rest: number;
  if (m < 120) rest = 0;
  else if (m <= 360) rest = 1;
  else if (m <= 600) rest = 2;
  else if (m <= 840) rest = 3;
  else rest = 4;

  let meal: number;
  if (m <= 240) meal = 0;
  else if (m <= 720) meal = 1;
  else meal = 2;

  return { rest, meal };
}

/** Minutes at work minus the unpaid meal breaks. */
export function paidMinutes(minutesAtWork: number): number {
  return minutesAtWork - MEAL_BREAK_MINUTES * nzBreaks(minutesAtWork).meal;
}

/** "09:30" -> 570 minutes after midnight, or null. */
export function parseHHMM(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** Minutes from start to finish. A finish earlier than the start is the
 *  next morning. Null if either time is missing or they're the same.
 *  (Ignores daylight saving; the database uses the real instants.) */
export function minutesBetween(start: string, finish: string): number | null {
  const s = parseHHMM(start);
  const f = parseHHMM(finish);
  if (s === null || f === null || s === f) return null;
  return f > s ? f - s : f + 24 * 60 - s;
}

/** 450 -> "7.5 h", 480 -> "8 h", 455 -> "7.58 h". */
export function hoursText(minutes: number): string {
  return `${Number((minutes / 60).toFixed(2))} h`;
}

/** "7 h at work, 2 x 10 min paid rest, 1 x 30 min meal, 6.5 h paid" */
export function breakSummary(minutesAtWork: number): string {
  const { rest, meal } = nzBreaks(minutesAtWork);
  const parts = [`${hoursText(minutesAtWork)} at work`];
  parts.push(rest === 0 ? "no rest break" : `${rest} x ${REST_BREAK_MINUTES} min paid rest`);
  parts.push(meal === 0 ? "no meal break" : `${meal} x ${MEAL_BREAK_MINUTES} min meal`);
  parts.push(`${hoursText(paidMinutes(minutesAtWork))} paid`);
  return parts.join(", ");
}
