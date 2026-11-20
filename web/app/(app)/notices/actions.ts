"use server";

// Server actions for the notice board: post or edit (managers and owner),
// archive, mark read, acknowledge.
//
// Never trust the arguments. The real guards are in the database (grants,
// RLS and the triggers in the notices migration). These checks give
// friendly messages.

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { aucklandDate } from "@/lib/dates";
import { validateNotice, type NoticeForm } from "@/lib/notices";
import { notifyNewNotice } from "@/lib/notify";
import { createClient } from "@/lib/supabase/server";

export type NoticeFormState = {
  seq: number;
  message?: string;
  errors?: Record<string, string>;
  values?: NoticeForm;
};
export type NoticeActionResult = { ok: boolean; message?: string };

const READABLE_CODES = new Set(["23514", "42501", "22023"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function readable(error: { code?: string; message: string }, what: string): string {
  return error.code !== undefined && READABLE_CODES.has(error.code) ? error.message : `Could not ${what}: ${error.message}`;
}

async function signedIn() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  return { supabase, userId: auth?.claims?.sub ?? null };
}

/** "New notice" and "Edit": one form. A hidden notice_id means edit. */
export async function saveNotice(prev: NoticeFormState, formData: FormData): Promise<NoticeFormState> {
  const seq = prev.seq + 1;
  const noticeId = text(formData, "notice_id");
  const typed: NoticeForm = {
    title: text(formData, "title"),
    body: text(formData, "body"),
    audience: text(formData, "audience"),
    site_ids: formData.getAll("site_ids").filter((v): v is string => typeof v === "string"),
    pinned: formData.get("pinned") === "on",
    needs_ack: formData.get("needs_ack") === "on",
    expires_on: text(formData, "expires_on"),
  };

  const { supabase, userId } = await signedIn();
  if (!userId) return { seq, message: "You are signed out. Sign in again.", values: typed };
  if (noticeId && !UUID_RE.test(noticeId)) return { seq, message: "That notice doesn't exist.", values: typed };

  const { data: sites } = await supabase.from("sites").select("id").eq("active", true);
  const { values, errors } = validateNotice(
    typed,
    aucklandDate(),
    (sites ?? []).map((s) => s.id as string),
  );
  if (!values) return { seq, message: "Check the highlighted fields.", errors, values: typed };

  if (noticeId) {
    const { data, error } = await supabase.from("notices").update(values).eq("id", noticeId).select("id");
    if (error) return { seq, message: readable(error, "save"), values: typed };
    // RLS hides the row from staff, so "nothing updated" means not allowed.
    if (!data || data.length === 0) {
      return { seq, message: "Only managers and the owner can edit notices.", values: typed };
    }
    refresh();
    redirect(`/notices/${noticeId}`);
  }

  const { data, error } = await supabase.from("notices").insert(values).select("id").single();
  if (error || !data) return { seq, message: readable(error ?? { message: "no id" }, "post"), values: typed };

  // Phone notifications, after the response is sent so posting stays quick.
  const posted = { id: data.id as string, title: values.title, siteIds: values.site_ids, needsAck: values.needs_ack, postedBy: userId };
  after(() => notifyNewNotice(posted));

  refresh();
  redirect(`/notices/${data.id}`);
}

/** Archive: final. It disappears for staff; managers still see it. */
export async function archiveNotice(noticeId: string): Promise<NoticeActionResult> {
  const { supabase, userId } = await signedIn();
  if (!userId) return { ok: false, message: "You are signed out. Sign in again." };
  if (!UUID_RE.test(noticeId)) return { ok: false, message: "That notice doesn't exist." };

  // The database stamps its own time; this value only says "archive it".
  const { data, error } = await supabase
    .from("notices")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", noticeId)
    .select("id");
  if (error) return { ok: false, message: readable(error, "archive") };
  if (!data || data.length === 0) return { ok: false, message: "Only managers and the owner can archive notices." };

  refresh();
  redirect("/notices");
}

/** Opening a notice marks it read. A second time does nothing. */
export async function markNoticeRead(noticeId: string): Promise<NoticeActionResult> {
  const { supabase, userId } = await signedIn();
  if (!userId) return { ok: false };
  if (!UUID_RE.test(noticeId)) return { ok: false };

  // ON CONFLICT DO NOTHING: staff_id defaults to you in the database.
  const { error } = await supabase
    .from("notice_reads")
    .upsert({ notice_id: noticeId }, { onConflict: "notice_id,staff_id", ignoreDuplicates: true });
  if (error) return { ok: false, message: readable(error, "mark it read") };

  refresh();
  return { ok: true };
}

/** "I've read and understood this". Final: it can't be taken back. */
export async function acknowledgeNotice(noticeId: string): Promise<NoticeActionResult> {
  const { supabase, userId } = await signedIn();
  if (!userId) return { ok: false, message: "You are signed out. Sign in again." };
  if (!UUID_RE.test(noticeId)) return { ok: false, message: "That notice doesn't exist." };

  const marked = await markNoticeRead(noticeId);
  if (!marked.ok) return { ok: false, message: marked.message ?? "Could not save. Try again." };

  // The database stamps its own time and refuses to change it later.
  const { error } = await supabase
    .from("notice_reads")
    .update({ acknowledged_at: new Date().toISOString() })
    .eq("notice_id", noticeId)
    .eq("staff_id", userId)
    .is("acknowledged_at", null);
  if (error) return { ok: false, message: readable(error, "save") };

  refresh();
  return { ok: true, message: "Thanks, that's recorded." };
}
