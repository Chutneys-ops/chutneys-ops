// Time helpers: the week a date belongs to, and Auckland wall-clock time
// <-> UTC. Pure functions: no React, no Supabase.
//
// Hours worked now come from timesheets (lib/breaks.ts, lib/timesheets.ts);
// the old clock-in/clock-out maths was removed with that change.

const MINUTE = 60_000;

/** A site choice ("Choose site") lasts this long. Matches
 *  stale_shift_cutoff() in the database (now() - 14 hours), so the header
 *  never shows a site whose records you can no longer add to. */
export const STALE_HOURS = 14;

/** The Monday on or before a "YYYY-MM-DD" date (weeks run Monday to Sunday). */
export function weekStart(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  const daysSinceMonday = (d.getUTCDay() + 6) % 7; // Sunday is 0 in JS
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  return d.toISOString().slice(0, 10);
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
