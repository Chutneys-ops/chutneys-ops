"use server";

// Server actions for one record sheet: add an entry, sign the sheet off.
//
// Never trust the arguments: anyone can call a server action with any ids or
// values. The real guards are in the database (grants, RLS with
// on_shift_at, the record_entries trigger, sign_off_sheet). The checks here
// only give friendly messages before the database says no.

import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentShift } from "@/lib/supabase/session";
import { aucklandDate } from "@/lib/dates";
import { findOutOfRange, parseEntryForm, type EntryValues, type RecordField } from "@/lib/records";
import type { EntryTarget, FormState } from "./form-state";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type DbError = { code?: string; message: string };

// Errors raised by our own trigger and functions already read well.
const READABLE_CODES = new Set(["23514", "42501", "22023"]);

function dbMessage(error: DbError, fallback: string): string {
  if (error.code === "28P01") return "Wrong PIN. Try again.";
  if (error.code && READABLE_CODES.has(error.code)) return error.message;
  return `${fallback}: ${error.message}`;
}

function formText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/** Everything typed into the form, to hand back if the save fails. */
function typedValues(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !key.startsWith("$")) out[key] = value;
  }
  return out;
}

async function findTodaySheet(supabase: Supabase, siteId: string, code: string) {
  return supabase
    .from("record_sheets")
    .select("id, signed_off_at")
    .eq("site_id", siteId)
    .eq("template_code", code)
    .eq("sheet_date", aucklandDate())
    .maybeSingle();
}

/** Today's sheet at the site, created on the first entry. */
async function getOrCreateTodaySheet(
  supabase: Supabase,
  siteId: string,
  code: string,
): Promise<{ id: string; signed_off_at: string | null } | { error: string }> {
  const existing = await findTodaySheet(supabase, siteId, code);
  if (existing.error) return { error: `Could not load today's sheet: ${existing.error.message}` };
  if (existing.data) return existing.data;

  // sheet_date, started_by and started_at all come from database defaults.
  // ignoreDuplicates: two phones saving the first entry at once is fine.
  const { error } = await supabase
    .from("record_sheets")
    .upsert(
      { site_id: siteId, template_code: code },
      { onConflict: "site_id,template_code,sheet_date", ignoreDuplicates: true },
    );
  if (error) return { error: dbMessage(error, "Could not start today's sheet") };

  const created = await findTodaySheet(supabase, siteId, code);
  if (!created.data) return { error: "Could not start today's sheet. Try again." };
  return created.data;
}

async function entryValues(supabase: Supabase, entryId: string): Promise<EntryValues | null> {
  const { data } = await supabase.from("record_entries").select("values").eq("id", entryId).maybeSingle();
  return data ? (data.values as EntryValues) : null;
}

export async function addEntry(
  code: string,
  target: EntryTarget,
  prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const seq = prev.seq + 1;
  const values = typedValues(formData);
  const fail = (message: string, errors?: Record<string, string>): FormState => ({
    seq,
    message,
    errors,
    values,
  });

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return fail("You are signed out. Sign in again.");

  // Read the fields from the database, not from the browser.
  const { data: template } = await supabase
    .from("record_templates")
    .select("fields")
    .eq("code", code)
    .maybeSingle();
  if (!template) return fail("That kind of record doesn't exist.");
  const fields = template.fields as RecordField[];

  let sheetId: string;
  let base: EntryValues = {}; // the original entry's values, for follow-ups
  let skipRequired = false;
  let amendsId: string | null = null;
  let continuesId: string | null = null;

  if (target.kind === "new") {
    // The site is wherever you're clocked in, never something from the page.
    const shift = await getCurrentShift(supabase, userId);
    if (!shift) return fail("Clock in at a site first (Change site, at the top).");
    const sheet = await getOrCreateTodaySheet(supabase, shift.site.id, code);
    if ("error" in sheet) return fail(sheet.error);
    if (sheet.signed_off_at) return fail("This sheet is signed off. Add a correction instead.");
    sheetId = sheet.id;
  } else if (target.kind === "followup") {
    sheetId = target.sheetId;
    continuesId = target.entryId;
    skipRequired = true;
    const root = await entryValues(supabase, target.entryId);
    if (!root) return fail("Couldn't find the entry this reading belongs to.");
    base = root;
  } else {
    sheetId = target.sheetId;
    amendsId = formText(formData, "amends_entry_id") || null;
    if (!amendsId) return fail("Pick the entry you're correcting.", { amends_entry_id: "Pick an entry" });
    const { data: amended } = await supabase
      .from("record_entries")
      .select("continues_entry_id")
      .eq("id", amendsId)
      .maybeSingle();
    if (!amended) return fail("Couldn't find the entry you're correcting.");
    // Correcting a later reading: the first entry's fields aren't needed again.
    if (amended.continues_entry_id) {
      skipRequired = true;
      base = (await entryValues(supabase, amended.continues_entry_id)) ?? {};
    }
  }

  const parsed = parseEntryForm(
    fields,
    (key) => {
      const value = formData.get(key);
      return typeof value === "string" ? value : null;
    },
    { skipRequired },
  );
  // "note" is the Comments box: optional, except on corrections.
  const note = formText(formData, "note");
  const correctiveAction = formText(formData, "corrective_action");

  const errors = { ...parsed.errors };
  if (target.kind === "correction" && !note) errors.note = "Say what was wrong with the original entry";
  if (note.length > 500) errors.note = "Comments are too long (500 characters at most)";
  const outOfRange = findOutOfRange(fields, { ...base, ...parsed.values }).length > 0;
  if (outOfRange && !correctiveAction) {
    errors.corrective_action = "Out of range: say what you did about it";
  }
  if (Object.keys(errors).length > 0) {
    return fail(errors._form ?? "Check the highlighted fields.", errors);
  }

  // recorded_by, recorded_at and out_of_range are set by the database.
  const { error } = await supabase.from("record_entries").insert({
    sheet_id: sheetId,
    values: parsed.values,
    corrective_action: correctiveAction || null,
    note: note || null,
    amends_entry_id: amendsId,
    continues_entry_id: continuesId,
  });
  if (error) return fail(dbMessage(error, "Could not save"));

  refresh();
  return { seq, ok: true, message: "Saved" };
}

export async function signOff(sheetId: string, prev: FormState, formData: FormData): Promise<FormState> {
  const seq = prev.seq + 1;
  // Never send the PIN back to the browser in `values`.
  const fail = (message: string): FormState => ({ seq, message, errors: { pin: message } });

  const pin = formText(formData, "pin");
  if (!/^\d{4}$/.test(pin)) return fail("Enter your 4-digit PIN.");

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims?.sub) return fail("You are signed out. Sign in again.");

  // sign_off_sheet checks you're a manager or owner and the PIN, then stamps
  // signed_off_by and signed_off_at itself.
  const { error } = await supabase.rpc("sign_off_sheet", { sheet_id: sheetId, pin });
  if (error) return fail(dbMessage(error, "Could not sign off"));

  refresh();
  return { seq, ok: true, message: "Signed off" };
}
