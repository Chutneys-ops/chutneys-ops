// The owner's "hours and leave" CSV for payroll: one row per timesheet or
// approved leave request. Pure, so it's tested with node --test.
//
// Columns: Name, Site, Date, Start, Finish, At work (h), Rest breaks,
// Meal breaks, Paid hours, Type, Status, Edit note.
//   Timesheet rows: Start and Finish are the Auckland times entered (a
//   Finish earlier than Start is the next morning). Breaks and paid hours
//   come from the database (nz_breaks), never from the browser.
//   Leave rows: Start and Finish are the first and last day (YYYY-MM-DD),
//   because one request can cover several days; Paid hours is the leave.

import { buildCsv } from "./csv.ts";
import { aucklandLocalToUtc } from "./hours.ts";
import { LEAVE_REASON_LABELS, isYmd, type LeaveReason } from "./leave.ts";

export const MAX_EXPORT_DAYS = 92;

export type TimesheetExportRow = {
  name: string;
  site: string;
  work_date: string;
  start_time: string; // "09:00:00"
  finish_time: string;
  minutes_at_work: number;
  rest_breaks: number;
  meal_breaks: number;
  paid_minutes: number;
  status: "submitted" | "approved";
  edit_note: string | null;
};

export type LeaveExportRow = {
  name: string;
  start_date: string;
  end_date: string;
  hours: number | string;
  reason: LeaveReason;
};

export const HOURS_CSV_HEADER = [
  "Name",
  "Site",
  "Date",
  "Start",
  "Finish",
  "At work (h)",
  "Rest breaks",
  "Meal breaks",
  "Paid hours",
  "Type",
  "Status",
  "Edit note",
];

/** 450 minutes -> "7.50" */
export function hoursFromMinutes(minutes: number): string {
  return (minutes / 60).toFixed(2);
}

/** Check the date range the owner picked. */
export function checkExportRange(from: string, to: string): string | null {
  if (!isYmd(from) || !isYmd(to)) return "Pick a start and end date.";
  if (from > to) return "The start date must be before the end date.";
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  if (days > MAX_EXPORT_DAYS) return `Export at most ${MAX_EXPORT_DAYS} days at a time.`;
  return null;
}

/** Auckland days from..to (inclusive) as a UTC range [start, end). Used by
 *  the audit log's date filter. */
export function exportBounds(from: string, to: string): { start: string; end: string } {
  const next = new Date(`${to}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const start = aucklandLocalToUtc(`${from}T00:00`);
  const end = aucklandLocalToUtc(`${next.toISOString().slice(0, 10)}T00:00`);
  if (!start || !end) throw new Error(`Bad range ${from}..${to}`);
  return { start: start.toISOString(), end: end.toISOString() };
}

/** Timesheets and leave -> CSV, sorted by name, then date, then start. */
export function hoursCsv(timesheets: TimesheetExportRow[], leave: LeaveExportRow[]): string {
  type Row = { sort: string; cells: (string | number)[] };
  const rows: Row[] = [];

  for (const t of timesheets) {
    const start = t.start_time.slice(0, 5);
    rows.push({
      sort: `${t.name}\u0000${t.work_date}\u0000${start}`,
      cells: [
        t.name,
        t.site,
        t.work_date,
        start,
        t.finish_time.slice(0, 5),
        hoursFromMinutes(t.minutes_at_work),
        t.rest_breaks,
        t.meal_breaks,
        hoursFromMinutes(t.paid_minutes),
        "Hours worked",
        t.status === "approved" ? "Approved" : "Waiting for approval",
        t.edit_note ?? "",
      ],
    });
  }

  for (const l of leave) {
    rows.push({
      // "~" sorts after any time, so on the same day leave comes after hours.
      sort: `${l.name}\u0000${l.start_date}\u0000~`,
      cells: [
        l.name,
        "",
        l.start_date,
        l.start_date,
        l.end_date,
        "",
        "",
        "",
        Number(l.hours).toFixed(2),
        `Leave: ${LEAVE_REASON_LABELS[l.reason]}`,
        "Approved",
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
