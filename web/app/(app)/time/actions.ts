"use server";

// Server actions for timesheets: add your hours, add hours for someone
// (managers), edit, delete while submitted, approve.
//
// Never trust the arguments. The database is the real guard (grants, RLS,
// timesheets_before_write, the no-overlap constraint, approve_timesheets).
// These checks only give friendly messages first.

import { refresh } from "next/cache";
import { aucklandDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { validateTimesheet } from "@/lib/timesheets";

export type TimesheetFormState = {
  seq: number;
  ok?: boolean;
  message?: string;
  errors?: Record<string, string>;
  values?: Record<string, string>;
};
export type ActionResult = { seq: number; ok?: boolean; message?: string };

/** What the form saves: your own new hours, someone else's (managers), or
 *  an edit. `needsNote` comes from the page; the database checks it again. */
export type TimesheetTarget =
  | { kind: "mine" }
  | { kind: "someone" }
  | { kind: "edit"; id: string; needsNote: boolean };

const READABLE_CODES = new Set(["23514", "42501", "22023"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function dbMessage(error: { code?: string; message: string }): string {
  if (error.code === "23P01") return "These hours overlap another timesheet for the same person.";
  if (error.code && READABLE_CODES.has(error.code)) return error.message;
  return `Could not save: ${error.message}`;
}

export async function saveTimesheet(
  target: TimesheetTarget,
  prev: TimesheetFormState,
  formData: FormData,
): Promise<TimesheetFormState> {
  const seq = prev.seq + 1;
  const typed = {
    work_date: text(formData, "work_date"),
    site_id: text(formData, "site_id"),
    start_time: text(formData, "start_time"),
    finish_time: text(formData, "finish_time"),
    edit_note: text(formData, "edit_note"),
    staff_id: text(formData, "staff_id"),
  };
  const fail = (message: string, errors?: Record<string, string>): TimesheetFormState => ({
    seq,
    message,
    errors,
    values: typed,
  });

  const needsNote = target.kind === "someone" || (target.kind === "edit" && target.needsNote);
  const { values, errors } = validateTimesheet(typed, aucklandDate(), needsNote);
  if (target.kind === "someone" && !UUID_RE.test(typed.staff_id)) errors.staff_id = "Who are these hours for?";
  if (!values || Object.keys(errors).length > 0) return fail("Check the highlighted fields.", errors);

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return fail("You are signed out. Sign in again.");

  if (target.kind === "edit") {
    const { data, error } = await supabase.from("timesheets").update(values).eq("id", target.id).select("id");
    if (error) return fail(dbMessage(error));
    if (!data?.length) return fail("Those hours couldn't be changed. They may have been deleted.");
  } else {
    const row = target.kind === "someone" ? { ...values, staff_id: typed.staff_id } : values;
    const { error } = await supabase.from("timesheets").insert(row);
    if (error) return fail(dbMessage(error));
  }

  refresh();
  return {
    seq,
    ok: true,
    message: target.kind === "edit" ? "Hours updated" : "Hours saved. A manager will approve them.",
  };
}

/** Delete hours that haven't been approved yet. */
export async function deleteTimesheet(id: string, prev: ActionResult): Promise<ActionResult> {
  const seq = prev.seq + 1;
  const supabase = await createClient();
  const { data, error } = await supabase.from("timesheets").delete().eq("id", id).select("id");
  if (error) return { seq, message: dbMessage(error) };
  // RLS hides approved rows from delete, so nothing is deleted rather than an error.
  if (!data?.length) return { seq, message: "Approved hours can't be deleted. Ask a manager to change them." };
  refresh();
  return { seq, ok: true, message: "Deleted" };
}

/** Approve a group (e.g. one week at one site). approve_timesheets skips
 *  your own (unless you're the owner) and anything already approved. */
export async function approveTimesheets(ids: string[], prev: ActionResult): Promise<ActionResult> {
  const seq = prev.seq + 1;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("approve_timesheets", { ids });
  if (error) return { seq, message: dbMessage(error) };
  refresh();
  const n = typeof data === "number" ? data : 0;
  return { seq, ok: true, message: `Approved ${n} ${n === 1 ? "timesheet" : "timesheets"}` };
}
