// Pure helpers for sick leave: no React, no Supabase, so they run in the
// browser, on the server and under `node --test`.
//
// The database is the real guard (grants, RLS, checks, decide_leave,
// clear_to_work, start_shift). These mirror it for friendly messages.
//
// Leave is stored in hours, not days: the Employment Leave Act 2026 moves
// leave to hours. "Whole days" in the form is just days x hours per day.

export const LEAVE_REASONS = ["sick", "injured", "caring_for_dependant"] as const;
export type LeaveReason = (typeof LEAVE_REASONS)[number];

export const LEAVE_REASON_LABELS: Record<LeaveReason, string> = {
  sick: "Sick",
  injured: "Injured",
  caring_for_dependant: "Caring for a dependant",
};

export type LeaveStatus = "pending" | "approved" | "declined";

export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  pending: "Waiting for a manager",
  approved: "Approved",
  declined: "Declined",
};

export const DEFAULT_HOURS_PER_DAY = 8;
export const MAX_LEAVE_DAYS = 31;
export const NOTE_MAX = 300;

/** Shown when a manager clears someone after vomiting or diarrhoea. */
export const CLEARANCE_REMINDER =
  "MPI guidance: people with vomiting or diarrhoea must not handle food until 48 hours after symptoms stop.";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date as "YYYY-MM-DD"? (Rejects 2026-02-30.) */
export function isYmd(value: string): boolean {
  if (!YMD_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function dayNumber(ymd: string): number {
  return Date.parse(`${ymd}T00:00:00Z`) / 86_400_000;
}

/** Days from start to end, counting both: 20 Nov to 21 Nov is 2 days. */
export function daysInclusive(start: string, end: string): number | null {
  if (!isYmd(start) || !isYmd(end)) return null;
  const days = dayNumber(end) - dayNumber(start) + 1;
  return days >= 1 ? days : null;
}

/** "7.5" -> 7.5. Hours must be more than 0, under 1000, at most 2 decimals. */
export function parseHours(text: string): number | null {
  const cleaned = text.trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(cleaned)) return null;
  const hours = Number(cleaned);
  return hours > 0 ? hours : null;
}

/** 16 -> "16 h", 7.5 -> "7.5 h". */
export function hoursText(hours: number | string): string {
  return `${Number(Number(hours).toFixed(2))} h`;
}

const shortDay = new Intl.DateTimeFormat("en-NZ", {
  timeZone: "UTC", // a plain date has no time zone; UTC leaves it unchanged
  weekday: "short",
  day: "numeric",
  month: "short",
});

/** "2026-11-20" -> "Fri 20 Nov" */
export function shortYmd(ymd: string): string {
  return shortDay.format(new Date(`${ymd}T00:00:00Z`)).replace(",", "");
}

/** "Fri 20 Nov" or "Fri 20 Nov to Sun 22 Nov". */
export function dateRangeText(start: string, end: string): string {
  return start === end ? shortYmd(start) : `${shortYmd(start)} to ${shortYmd(end)}`;
}

// ---- The request form ----------------------------------------------------------

export type LeaveInput = {
  start_date: string;
  end_date: string; // blank = same day
  amount: string; // "days" or "hours"
  hours_per_day: string;
  hours: string;
  reason: string;
  gi_symptoms: string; // "yes" or "no"
  note: string;
};

export type LeaveValues = {
  reason: LeaveReason;
  start_date: string;
  end_date: string;
  hours: string; // "16.00": exact, for numeric(5,2)
  gi_symptoms: boolean;
  note: string | null;
};

/** Check a sick leave request. `today` is the Auckland date (YYYY-MM-DD). */
export function validateLeave(input: LeaveInput, today: string): { values: LeaveValues | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const start = input.start_date.trim();
  const end = input.end_date.trim() || start;
  const note = input.note.trim();

  if (!isYmd(start)) errors.start_date = "Pick the first day";
  else if (dayNumber(start) > dayNumber(today) + 30) errors.start_date = "Sick leave can't start more than 30 days from now";
  if (isYmd(start) && !isYmd(end)) errors.end_date = "Pick the last day";

  const days = daysInclusive(start, end);
  if (isYmd(start) && isYmd(end)) {
    if (days === null) errors.end_date = "The last day can't be before the first day";
    else if (days > MAX_LEAVE_DAYS) errors.end_date = `Ask for at most ${MAX_LEAVE_DAYS} days at a time`;
  }

  let hours: number | null = null;
  if (input.amount === "days") {
    const perDay = parseHours(input.hours_per_day);
    if (perDay === null || perDay > 24) errors.hours_per_day = "Hours per day, like 8 or 7.5";
    else if (days !== null) hours = Math.round(days * perDay * 100) / 100;
  } else if (input.amount === "hours") {
    hours = parseHours(input.hours);
    if (hours === null) errors.hours = "Hours, like 4 or 7.5";
  } else {
    errors.amount = "Whole days or hours?";
  }
  if (hours !== null && hours > 999.99) errors.hours = "That's too many hours";

  const reason = LEAVE_REASONS.find((r) => r === input.reason);
  if (!reason) errors.reason = "Pick a reason";

  if (input.gi_symptoms !== "yes" && input.gi_symptoms !== "no") {
    errors.gi_symptoms = "Answer the vomiting or diarrhoea question";
  }

  if (note.length > NOTE_MAX) errors.note = `Keep it under ${NOTE_MAX} characters`;

  if (Object.keys(errors).length > 0 || !reason || hours === null) return { values: null, errors };
  return {
    values: {
      reason,
      start_date: start,
      end_date: end,
      hours: hours.toFixed(2),
      gi_symptoms: input.gi_symptoms === "yes",
      note: note || null,
    },
    errors,
  };
}
