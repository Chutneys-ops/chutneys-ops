"use server";

// Server actions for sick leave: request it, decide it, clear someone to
// return to work after vomiting or diarrhoea.
//
// Never trust the arguments. The real guards are in the database (grants,
// RLS, decide_leave, clear_to_work). These checks only give friendly messages.

import { refresh } from "next/cache";
import { aucklandDate } from "@/lib/dates";
import { parseHours, validateLeave } from "@/lib/leave";
import { createClient } from "@/lib/supabase/server";
import { isOwnFilePath } from "@/lib/uploads";

export type LeaveResult = { ok: boolean; message?: string; errors?: Record<string, string> };
export type DecisionState = { seq: number; ok?: boolean; message?: string };

const READABLE_CODES = new Set(["23514", "42501", "22023"]);
const CERTIFICATE_EXTENSIONS = ["jpg", "png", "webp", "pdf"];

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function dbMessage(error: { code?: string; message: string }, fallback: string): string {
  return error.code && READABLE_CODES.has(error.code) ? error.message : `${fallback}: ${error.message}`;
}

/** Request sick leave. The browser has already uploaded the certificate (if
 *  any) into your own folder and sends its path. */
export async function requestLeave(formData: FormData): Promise<LeaveResult> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return { ok: false, message: "You are signed out. Sign in again." };

  const certificatePath = text(formData, "certificate_path").trim() || null;
  if (certificatePath && !isOwnFilePath(certificatePath, userId, CERTIFICATE_EXTENSIONS)) {
    return { ok: false, message: "That certificate upload isn't yours. Pick the file again." };
  }
  const removeUpload = async () => {
    if (certificatePath) await supabase.storage.from("leave-documents").remove([certificatePath]);
  };

  const { values, errors } = validateLeave(
    {
      start_date: text(formData, "start_date"),
      end_date: text(formData, "end_date"),
      amount: text(formData, "amount"),
      hours_per_day: text(formData, "hours_per_day"),
      hours: text(formData, "hours"),
      reason: text(formData, "reason"),
      gi_symptoms: text(formData, "gi_symptoms"),
      note: text(formData, "note"),
    },
    aucklandDate(),
  );
  if (!values) {
    await removeUpload();
    return { ok: false, message: "Check the highlighted fields.", errors };
  }

  const { error } = await supabase.from("leave_requests").insert({ ...values, certificate_path: certificatePath });
  if (error) {
    await removeUpload();
    return { ok: false, message: dbMessage(error, "Could not send your request") };
  }

  refresh();
  return {
    ok: true,
    message: values.gi_symptoms
      ? "Request sent. Because of the vomiting or diarrhoea, you can't choose a site or add hours for later days until a manager clears you."
      : "Request sent to your manager.",
  };
}

/** Approve or decline (the button pressed sends "status"). Hours can be
 *  adjusted when approving; declining needs a note. */
export async function decideLeave(requestId: string, prev: DecisionState, formData: FormData): Promise<DecisionState> {
  const seq = prev.seq + 1;
  const status = text(formData, "status");
  if (status !== "approved" && status !== "declined") return { seq, message: "Approve or decline." };

  const hoursText = text(formData, "hours").trim();
  const hours = hoursText ? parseHours(hoursText) : null;
  if (hoursText && hours === null) return { seq, message: "Hours, like 8 or 7.5." };
  const note = text(formData, "note").trim();
  if (status === "declined" && !note) return { seq, message: "Add a note saying why it's declined." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_leave", {
    request_id: requestId,
    new_status: status,
    new_hours: status === "approved" ? hours : null,
    note: note || null,
  });
  if (error) return { seq, message: dbMessage(error, "Could not save the decision") };

  refresh();
  return { seq, ok: true, message: status === "approved" ? "Approved" : "Declined" };
}

/** A manager confirms someone can handle food again (48 hours symptom-free). */
export async function clearToWork(requestId: string, prev: DecisionState, formData: FormData): Promise<DecisionState> {
  const seq = prev.seq + 1;
  if (formData.get("confirm_48h") !== "on") {
    return { seq, message: "Tick the box to confirm they've been free of symptoms for 48 hours." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("clear_to_work", { request_id: requestId });
  if (error) return { seq, message: dbMessage(error, "Could not clear them") };

  refresh();
  return { seq, ok: true, message: "Cleared to return to work" };
}
