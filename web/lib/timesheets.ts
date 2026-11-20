// Pure helpers for timesheets: the form check and grouping hours for
// approval. The database is the real guard (timesheets_before_write, the
// no-overlap constraint, RLS); these give friendly messages first.

import { MAX_SHIFT_MINUTES, minutesBetween } from "./breaks.ts";
import { weekStart } from "./hours.ts";
import { isYmd, shortYmd } from "./leave.ts";

export type TimesheetStatus = "submitted" | "approved";

export const TIMESHEET_STATUS_LABELS: Record<TimesheetStatus, string> = {
  submitted: "Waiting for approval",
  approved: "Approved",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TimesheetInput = {
  work_date: string;
  site_id: string;
  start_time: string;
  finish_time: string;
  edit_note: string;
};

export type TimesheetValues = {
  work_date: string;
  site_id: string;
  start_time: string;
  finish_time: string;
  edit_note: string | null;
};

/** Check the hours form. `needsNote`: a manager adding or changing someone
 *  else's hours, or changing approved hours. */
export function validateTimesheet(
  input: TimesheetInput,
  today: string,
  needsNote: boolean,
): { values: TimesheetValues | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const note = input.edit_note.trim();

  if (!isYmd(input.work_date)) errors.work_date = "Pick the date";
  else if (input.work_date > today) errors.work_date = "You can't enter hours for a future date";

  if (!UUID_RE.test(input.site_id)) errors.site_id = "Pick the site";

  const minutes = minutesBetween(input.start_time, input.finish_time);
  if (!input.start_time) errors.start_time = "When did you start?";
  if (!input.finish_time) errors.finish_time = "When did you finish?";
  else if (input.start_time && minutes === null) errors.finish_time = "The finish time must be after the start time";
  else if (minutes !== null && minutes > MAX_SHIFT_MINUTES) errors.finish_time = "That's more than 16 hours";

  if (needsNote && !note) errors.edit_note = "Add a note saying why";
  if (note.length > 300) errors.edit_note = "Keep it under 300 characters";

  if (Object.keys(errors).length > 0) return { values: null, errors };
  return {
    values: {
      work_date: input.work_date,
      site_id: input.site_id,
      start_time: input.start_time,
      finish_time: input.finish_time,
      edit_note: note || null,
    },
    errors,
  };
}

/** "09:00:00" (Postgres time) -> "09:00". */
export function hhmm(time: string): string {
  return time.slice(0, 5);
}

/** "Week of Mon 16 Nov" */
export function weekLabel(monday: string): string {
  return `Week of ${shortYmd(monday)}`;
}

export type ApprovalRow = { id: string; work_date: string; site_id: string; site_name: string };
export type ApprovalGroup<R extends ApprovalRow> = {
  key: string;
  week: string; // the Monday
  siteId: string;
  siteName: string;
  rows: R[];
};

/** Hours waiting for approval, grouped by week (Monday to Sunday) and site:
 *  newest week first, then sites by name, then rows by date. */
export function groupForApproval<R extends ApprovalRow>(rows: R[]): ApprovalGroup<R>[] {
  const groups = new Map<string, ApprovalGroup<R>>();
  for (const row of rows) {
    const week = weekStart(row.work_date);
    const key = `${week}|${row.site_id}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, week, siteId: row.site_id, siteName: row.site_name, rows: [] };
      groups.set(key, group);
    }
    group.rows.push(row);
  }
  for (const group of groups.values()) group.rows.sort((a, b) => a.work_date.localeCompare(b.work_date));
  return [...groups.values()].sort((a, b) =>
    a.week === b.week ? a.siteName.localeCompare(b.siteName) : b.week.localeCompare(a.week),
  );
}
