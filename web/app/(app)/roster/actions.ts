"use server";

// Server actions for the roster (managers and the owner): add, change and
// delete shifts, copy last week, publish.
//
// Never trust the arguments. The database is the real guard (RLS, column
// grants, roster_shifts_before_write, the no-overlap constraint and the
// manager checks inside the functions). These checks only give friendly
// messages first.

import { refresh } from "next/cache";
import { after } from "next/server";
import { notifyRosterPublished } from "@/lib/notify";
import { validateShift } from "@/lib/roster";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "../time/actions";

export type ShiftFormState = {
  seq: number;
  ok?: boolean;
  message?: string;
  errors?: Record<string, string>;
  values?: Record<string, string>;
};

/** Add a shift to a site's week (the week row is made if needed), or change one. */
export type ShiftTarget = { kind: "add"; siteId: string; monday: string } | { kind: "edit"; id: string; monday: string };

const READABLE_CODES = new Set(["23514", "42501", "22023"]);

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function dbMessage(error: { code?: string; message: string }): string {
  if (error.code === "23P01") return "This person is already rostered at that time, at this or another site.";
  if (error.code && READABLE_CODES.has(error.code)) return error.message;
  return `Could not save: ${error.message}`;
}

export async function saveShift(target: ShiftTarget, prev: ShiftFormState, formData: FormData): Promise<ShiftFormState> {
  const seq = prev.seq + 1;
  const typed = {
    staff_id: text(formData, "staff_id"),
    work_date: text(formData, "work_date"),
    start_time: text(formData, "start_time"),
    finish_time: text(formData, "finish_time"),
    position: text(formData, "position"),
    note: text(formData, "note"),
  };
  const fail = (message: string, errors?: Record<string, string>): ShiftFormState => ({
    seq,
    message,
    errors,
    values: typed,
  });

  const { values, errors } = validateShift(typed, target.monday);
  if (!values) return fail("Check the highlighted fields.", errors);

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return fail("You are signed out. Sign in again.");

  if (target.kind === "edit") {
    const { data, error } = await supabase.from("roster_shifts").update(values).eq("id", target.id).select("id");
    if (error) return fail(dbMessage(error));
    if (!data?.length) return fail("That shift couldn't be changed. It may have been deleted.");
  } else {
    const week = await supabase.rpc("ensure_roster_week", { site: target.siteId, monday: target.monday });
    if (week.error) return fail(dbMessage(week.error));
    const { error } = await supabase.from("roster_shifts").insert({ ...values, roster_week_id: week.data as string });
    if (error) return fail(dbMessage(error));
  }

  refresh();
  return { seq, ok: true, message: target.kind === "edit" ? "Shift updated" : "Shift added" };
}

export async function deleteShift(id: string, prev: ActionResult): Promise<ActionResult> {
  const seq = prev.seq + 1;
  const supabase = await createClient();
  const { data, error } = await supabase.from("roster_shifts").delete().eq("id", id).select("id");
  if (error) return { seq, message: dbMessage(error) };
  if (!data?.length) return { seq, message: "That shift couldn't be deleted. It may already be gone." };
  refresh();
  return { seq, ok: true, message: "Shift deleted" };
}

/** Copy the previous week's shifts at this site into this week. */
export async function copyLastWeek(siteId: string, monday: string, prev: ActionResult): Promise<ActionResult> {
  const seq = prev.seq + 1;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("copy_roster_week", { site: siteId, monday });
  if (error) return { seq, message: dbMessage(error) };
  const { copied = 0, skipped = 0 } = (data ?? {}) as { copied?: number; skipped?: number };
  refresh();
  if (copied === 0 && skipped === 0) return { seq, ok: true, message: "Last week has no shifts to copy." };
  const parts = [`Copied ${copied} ${copied === 1 ? "shift" : "shifts"}`];
  if (skipped > 0) {
    parts.push(
      `skipped ${skipped} (the person is already rostered then, or their account is turned off)`,
    );
  }
  return { seq, ok: true, message: parts.join(", ") };
}

/** Publish or re-publish a week, then tell the people on it. */
export async function publishWeek(
  week: { id: string; siteId: string; monday: string },
  prev: ActionResult,
): Promise<ActionResult> {
  const seq = prev.seq + 1;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("publish_roster_week", { week_id: week.id });
  if (error) return { seq, message: dbMessage(error) };
  const republished = Boolean((data as { republished?: boolean } | null)?.republished);

  const { data: rows } = await supabase.from("roster_shifts").select("staff_id").eq("roster_week_id", week.id);
  const staffIds = [...new Set((rows ?? []).map((r) => r.staff_id as string))];
  // After the publish has succeeded, so a failed publish never notifies.
  // after(): the pushes go out once the response is sent.
  after(() => notifyRosterPublished({ weekId: week.id, siteId: week.siteId, weekStart: week.monday, staffIds, republished }));

  refresh();
  return { seq, ok: true, message: republished ? "Re-published. Staff see the changes." : "Published. Staff can see their shifts." };
}
