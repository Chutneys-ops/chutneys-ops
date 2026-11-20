// The one path every payslip PDF takes into the app: check it, work out
// whose it is, store the file and save an unpublished draft. The owner then
// reviews and publishes (More > Payslips).
//
// Today's caller: the owner's upload route (/more/payslips/upload), with
// the OWNER'S OWN session, so the database checks "is owner" on the file
// upload (Storage policy) and on the row (RLS).
//
// The seam for later: an inbound-email webhook (payroll emails the PDFs)
// can call ingestPayslip(admin, "email", file, staffHint, run) with the
// admin client, after checking its own secret. Drafts from email wait for
// the owner to publish, like uploads. Unmatched files are not stored (there
// is no person's folder to put them in); the webhook would need to keep
// them somewhere for the owner (README > Known follow-ups).
//
// Matching order: staffHint (chosen by the owner, or a hint in the email),
// then the file name (payroll code, full name, first or last name), then
// the text inside the PDF (read only when the name didn't match).

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  chosenMatch,
  checkRun,
  firstMatch,
  looksLikePdf,
  matchByFileName,
  matchByText,
  PAYSLIP_BUCKET,
  PAYSLIP_MAX_BYTES,
  payslipPath,
  type Match,
  type PayRun,
  type PayslipPerson,
} from "@/lib/payslips";
import { loadPayrollCodes } from "@/lib/supabase/payroll-codes";
import { newFileId } from "@/lib/uploads";

export type PayslipSource = "upload" | "email";
export type IncomingPayslip = { name: string; bytes: Uint8Array };

export type IngestResult =
  | { status: "saved"; payslipId: string; staffId: string; staffName: string; staffActive: boolean; match: Match }
  | { status: "unmatched"; match: Match }
  | { status: "error"; message: string; match?: Match };

const READABLE_CODES = new Set(["42501", "23514", "22023"]);

/** The PDF's text, or "" if it can't be read (scanned image, damaged,
 *  password). Never throws: the owner can still pick the person. */
export async function readPdfText(bytes: Uint8Array): Promise<string> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    // pdf.js may take over (detach) the buffer it's given: hand it a copy,
    // so the original bytes can still be uploaded afterwards.
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  } catch (error) {
    console.warn("Could not read the payslip's text:", (error as Error).message);
    return "";
  }
}

/** Store one payslip PDF as a draft for the person it belongs to.
 *  db: the owner's own client (uploads) or the admin client (email). */
export async function ingestPayslip(
  db: SupabaseClient,
  source: PayslipSource,
  file: IncomingPayslip,
  staffHint: string | null,
  run: PayRun,
): Promise<IngestResult> {
  const runErrors = Object.values(checkRun(run));
  if (runErrors.length > 0) return { status: "error", message: runErrors[0] ?? "Check the pay run dates." };
  if (file.bytes.byteLength === 0) return { status: "error", message: "That file is empty." };
  if (file.bytes.byteLength > PAYSLIP_MAX_BYTES) return { status: "error", message: "That PDF is over 2 MB." };
  if (!looksLikePdf(file.bytes)) return { status: "error", message: "That file isn't a PDF." };

  // Everyone who can get a payslip, leavers included (final pay). The
  // owner's session sees every staff row; payroll codes are private, so
  // they come from staff_payroll_codes() (everyone's, for the owner).
  const [{ data: staffRows, error: staffError }, { codes, error: codeError }] = await Promise.all([
    db.from("staff").select("id, name, active"),
    loadPayrollCodes(db),
  ]);
  const listError = staffError ?? codeError;
  if (listError) return { status: "error", message: `Could not read the staff list: ${listError.message}` };
  const people = ((staffRows ?? []) as { id: string; name: string; active: boolean }[]).map(
    (p): PayslipPerson & { active: boolean } => ({ ...p, payroll_code: codes.get(p.id) ?? null }),
  );
  const byId = new Map(people.map((p) => [p.id, p]));

  // 1. Who is it for?
  let match: Match;
  if (staffHint) {
    const person = byId.get(staffHint);
    if (!person) return { status: "error", message: "That person isn't on the staff list." };
    // A turned-off person is fine here (final pay): the database lets the
    // owner, and only the owner, add payslips for them.
    match = chosenMatch(person.id);
  } else {
    match = matchByFileName(file.name, people);
    if (!match.staffId) match = firstMatch(matchByText(await readPdfText(file.bytes), people), match);
  }
  if (!match.staffId) return { status: "unmatched", match };
  const person = byId.get(match.staffId)!;

  // 2. One live payslip per person per run: say so before uploading, so a
  //    refused row doesn't leave a stray file behind.
  const { data: existing } = await db
    .from("payslips")
    .select("id")
    .eq("staff_id", person.id)
    .eq("pay_date", run.payDate)
    .eq("period_start", run.periodStart)
    .eq("period_end", run.periodEnd)
    .is("withdrawn_at", null)
    .limit(1);
  if (existing && existing.length > 0) {
    return {
      status: "error",
      match,
      message: `${person.name} already has a payslip for this pay run. Withdraw that one first to replace it.`,
    };
  }

  // 3. The file, then the row (the database checks the file is there).
  const path = payslipPath(person.id, run.payDate, newFileId());
  const { error: uploadError } = await db.storage
    .from(PAYSLIP_BUCKET)
    .upload(path, file.bytes, { contentType: "application/pdf", upsert: false });
  if (uploadError) return { status: "error", match, message: `Could not store the PDF: ${uploadError.message}` };

  const { data: saved, error: insertError } = await db
    .from("payslips")
    .insert({
      staff_id: person.id,
      pay_date: run.payDate,
      period_start: run.periodStart,
      period_end: run.periodEnd,
      file_path: path,
      source,
    })
    .select("id")
    .single();
  if (insertError || !saved) {
    const message = insertError
      ? READABLE_CODES.has(insertError.code ?? "")
        ? insertError.message
        : `Could not save the payslip: ${insertError.message}`
      : "Could not save the payslip.";
    // Duplicate (two uploads at once for the same person).
    if (insertError?.code === "23505") {
      return { status: "error", match, message: `${person.name} already has a payslip for this pay run.` };
    }
    return { status: "error", match, message };
  }

  return {
    status: "saved",
    payslipId: saved.id as string,
    staffId: person.id,
    staffName: person.name,
    staffActive: person.active,
    match,
  };
}
