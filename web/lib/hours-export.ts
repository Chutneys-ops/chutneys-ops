// The owner's "hours and leave" CSV for payroll: one row per shift or
// approved leave request. Pure, so it's tested with node --test.
//
// Columns: Name, Site, Date, Start, End, Hours, Type, Edit note.
//   Shift rows: Date is the clock-in day; Start and End are 24-hour Auckland
//   times. An open shift has no End or Hours.
//   Leave rows: Date is the first day; Start and End are the first and last
//   day (YYYY-MM-DD), because one request can cover several days.

import { aucklandClock24, buildCsv } from "./csv.ts";
import { aucklandDate } from "./dates.ts";
import { aucklandLocalToUtc } from "./hours.ts";
import { LEAVE_REASON_LABELS, isYmd, type LeaveReason } from "./leave.ts";

export const MAX_EXPORT_DAYS = 92;

export type ShiftExportRow = {
  name: string;
  site: string;
  clock_in: string;
  clock_out: string | null;
  needs_review: boolean;
  edit_note: string | null;
};

export type LeaveExportRow = {
  name: string;
  start_date: string;
  end_date: string;
  hours: number | string;
  reason: LeaveReason;
};

export const HOURS_CSV_HEADER = ["Name", "Site", "Date", "Start", "End", "Hours", "Type", "Edit note"];

/** Hours between clock-in and clock-out, to 2 decimals. Null while open. */
export function shiftHours(clockIn: string, clockOut: string | null): number | null {
  if (!clockOut) return null;
  const ms = Date.parse(clockOut) - Date.parse(clockIn);
  return Math.round((ms / 3_600_000) * 100) / 100;
}

/** Check the date range the owner picked. */
export function checkExportRange(from: string, to: string): string | null {
  if (!isYmd(from) || !isYmd(to)) return "Pick a start and end date.";
  if (from > to) return "The start date must be before the end date.";
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  if (days > MAX_EXPORT_DAYS) return `Export at most ${MAX_EXPORT_DAYS} days at a time.`;
  return null;
}

/** Auckland days from..to (inclusive) as a UTC range [start, end), for clock_in. */
export function exportBounds(from: string, to: string): { start: string; end: string } {
  const next = new Date(`${to}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const start = aucklandLocalToUtc(`${from}T00:00`);
  const end = aucklandLocalToUtc(`${next.toISOString().slice(0, 10)}T00:00`);
  if (!start || !end) throw new Error(`Bad range ${from}..${to}`);
  return { start: start.toISOString(), end: end.toISOString() };
}

/** Shifts and leave -> CSV, sorted by name, then date, then start. */
export function hoursCsv(shifts: ShiftExportRow[], leave: LeaveExportRow[]): string {
  type Row = { sort: string; cells: (string | number)[] };
  const rows: Row[] = [];

  for (const s of shifts) {
    const date = aucklandDate(new Date(s.clock_in));
    const start = aucklandClock24(s.clock_in);
    const hours = shiftHours(s.clock_in, s.clock_out);
    rows.push({
      sort: `${s.name}\u0000${date}\u0000${start}`,
      cells: [
        s.name,
        s.site,
        date,
        start,
        s.clock_out ? aucklandClock24(s.clock_out) : "",
        hours === null ? "" : hours.toFixed(2),
        s.needs_review ? "Shift (needs review)" : s.clock_out ? "Shift" : "Shift (still open)",
        s.edit_note ?? "",
      ],
    });
  }

  for (const l of leave) {
    rows.push({
      // "~" sorts after any time, so on the same day leave comes after shifts.
      sort: `${l.name}\u0000${l.start_date}\u0000~`,
      cells: [
        l.name,
        "",
        l.start_date,
        l.start_date,
        l.end_date,
        Number(l.hours).toFixed(2),
        `Leave: ${LEAVE_REASON_LABELS[l.reason]}`,
        "",
      ],
    });
  }

  rows.sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0));
  return buildCsv(
    HOURS_CSV_HEADER,
    rows.map((r) => r.cells),
  );
}
