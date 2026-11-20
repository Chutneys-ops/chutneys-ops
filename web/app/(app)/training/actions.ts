"use server";

// Server actions for training records: a manager records training they
// gave; the trainee confirms it (optionally with a drawn signature).
//
// Never trust the arguments. The real guards are in the database (grants,
// RLS, confirm_training, the lock trigger). These checks give friendly messages.

import { refresh } from "next/cache";
import { aucklandDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { validateTraining } from "@/lib/training";
import { isOwnFilePath } from "@/lib/uploads";

export type TrainingFormState = {
  seq: number;
  ok?: boolean;
  message?: string;
  errors?: Record<string, string>;
  values?: Record<string, string>;
};
export type ConfirmResult = { ok: boolean; message?: string };

const READABLE_CODES = new Set(["23514", "42501", "22023"]);

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

/** "Record training": you (a manager or the owner) are the trainer. */
export async function recordTraining(prev: TrainingFormState, formData: FormData): Promise<TrainingFormState> {
  const seq = prev.seq + 1;
  const typed = {
    trainee_id: text(formData, "trainee_id"),
    topic: text(formData, "topic"),
    topic_detail: text(formData, "topic_detail"),
    trained_on: text(formData, "trained_on"),
    notes: text(formData, "notes"),
  };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return { seq, message: "You are signed out. Sign in again.", values: typed };

  const { values, errors } = validateTraining(typed, aucklandDate(), userId);
  if (!values) return { seq, message: "Check the highlighted fields.", errors, values: typed };

  const { error } = await supabase.from("training_records").insert(values);
  if (error) {
    const readable = error.code !== undefined && READABLE_CODES.has(error.code);
    return { seq, message: readable ? error.message : `Could not save: ${error.message}`, values: typed };
  }

  refresh();
  return { seq, ok: true, message: "Training recorded. They confirm it on their own login." };
}

/** The trainee confirms. signaturePath: a PNG they just uploaded into their
 *  own folder of "signatures", or null to confirm with the login alone. */
export async function confirmTraining(recordId: string, signaturePath: string | null): Promise<ConfirmResult> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return { ok: false, message: "You are signed out. Sign in again." };

  if (signaturePath && !isOwnFilePath(signaturePath, userId, ["png"])) {
    return { ok: false, message: "That signature upload isn't yours. Sign again." };
  }

  const { error } = await supabase.rpc("confirm_training", { record_id: recordId, signature_path: signaturePath });
  if (error) {
    if (signaturePath) await supabase.storage.from("signatures").remove([signaturePath]);
    const readable = error.code !== undefined && READABLE_CODES.has(error.code);
    return { ok: false, message: readable ? error.message : `Could not confirm: ${error.message}` };
  }

  refresh();
  return { ok: true, message: "Confirmed" };
}
