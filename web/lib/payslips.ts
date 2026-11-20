// Payslips: matching PDF files to people, pay run dates and labels, file
// checks and paths, and the "your payslip is ready" wording.
// Pure functions (no React, no Supabase), so they run under `node --test`.
//
// The database is the real guard (the payslips migration): who sees what,
// one live payslip per person per run, never edited or deleted. The upload
// and the matching order live in lib/payslips-ingest.ts (ingestPayslip).

import { weekStart } from "./hours.ts";
import { isYmd, shortYmd } from "./leave.ts";
import type { PushMessage } from "./reminders.ts";
import { addDays } from "./roster.ts";

export const PAYSLIP_BUCKET = "payslips";
/** Same as the bucket's file_size_limit (config.toml and the migration). */
export const PAYSLIP_MAX_BYTES = 2 * 1024 * 1024;
/** Same as payslips_period_length in the migration (end - start <= 31). */
export const MAX_PERIOD_DAYS = 32;
export const WITHDRAW_REASON_MAX = 300;
/** Same rule as staff_payroll_code_format in the migration. */
export const PAYROLL_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,19}$/;

// ---- People and matching ---------------------------------------------------------------

/** Turned-off people (leavers) are included: the owner can upload their
 *  final payslip. The review shows them as turned off. */
export type PayslipPerson = { id: string; name: string; payroll_code: string | null; active?: boolean };

/** How a file was matched to a person. */
export type MatchHow =
  | "chosen" // the owner picked the person (or the email had a staff hint)
  | "payroll_code" // the payroll code is in the file name
  | "full_name" // every part of the name is in the file name
  | "first_name" // only the first name (and nobody else has it)
  | "last_name" // only the last name (and nobody else has it)
  | "pdf_code" // "Employee code: E012" inside the PDF
  | "pdf_name" // the full name inside the PDF
  | "none";

export type Confidence = "high" | "medium" | "none";

export type Match = {
  staffId: string | null;
  how: MatchHow;
  confidence: Confidence;
  /** When more than one person fits, their ids (nobody is chosen). */
  candidates: string[];
};

export const NO_MATCH: Match = { staffId: null, how: "none", confidence: "none", candidates: [] };

const CONFIDENCE: Record<MatchHow, Confidence> = {
  chosen: "high",
  payroll_code: "high",
  full_name: "high",
  pdf_code: "high",
  first_name: "medium",
  last_name: "medium",
  pdf_name: "medium",
  none: "none",
};

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  high: "Sure",
  medium: "Check",
  none: "No match",
};

const HOW_LABELS: Record<MatchHow, string> = {
  chosen: "Chosen by you",
  payroll_code: "Payroll code in the file name",
  full_name: "Name in the file name",
  first_name: "First name only",
  last_name: "Last name only",
  pdf_code: "Payroll code inside the PDF",
  pdf_name: "Name inside the PDF",
  none: "No one matched",
};

/** "Payroll code in the file name", or "2 people match: Ana, Ana B". */
export function matchText(match: Match, names: Map<string, string> = new Map()): string {
  if (!match.staffId && match.candidates.length > 1) {
    const who = match.candidates.map((id) => names.get(id) ?? "someone").join(", ");
    return `${match.candidates.length} people match: ${who}`;
  }
  return HOW_LABELS[match.how];
}

function found(staffId: string, how: MatchHow): Match {
  return { staffId, how, confidence: CONFIDENCE[how], candidates: [] };
}

function ambiguous(ids: string[]): Match {
  return { ...NO_MATCH, candidates: [...new Set(ids)] };
}

/** "Māngere O'Brien_E012.pdf" -> ["mangere", "o", "brien", "e012", "pdf"].
 *  Lower case, accents removed, split on anything that isn't a letter or digit. */
export function tokens(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** "/uploads/Ana Smith.PDF" -> "Ana Smith" */
export function baseName(fileName: string): string {
  const last = fileName.split(/[\\/]/).pop() ?? "";
  return last.replace(/\.pdf$/i, "");
}

/** One person -> that person; several -> ambiguous; none -> null. */
function pick(ids: string[], how: MatchHow): Match | null {
  const unique = [...new Set(ids)];
  if (unique.length === 1) return found(unique[0], how);
  if (unique.length > 1) return ambiguous(unique);
  return null;
}

/** Of the people whose whole name fits, keep those with the longest name:
 *  "Ana Smith" beats "Ana" for "ana_smith.pdf". */
function longestNames(people: PayslipPerson[]): string[] {
  const longest = Math.max(0, ...people.map((p) => tokens(p.name).length));
  return people.filter((p) => tokens(p.name).length === longest).map((p) => p.id);
}

/** Whose payslip is this file, going by its name? In order:
 *  payroll code (a whole word), then full name, then a first or last name
 *  that only one person has. Leavers count too (final pay). */
export function matchByFileName(fileName: string, people: PayslipPerson[]): Match {
  const words = tokens(baseName(fileName));
  const set = new Set(words);
  const candidates = people;

  const byCode = candidates.filter((p) => p.payroll_code && set.has(p.payroll_code.toLowerCase()));
  const code = pick(byCode.map((p) => p.id), "payroll_code");
  if (code) return code;

  const byName = candidates.filter((p) => {
    const parts = tokens(p.name);
    return parts.length > 0 && parts.every((part) => set.has(part));
  });
  const full = pick(longestNames(byName), "full_name");
  if (full) return full;

  for (const [how, part] of [
    ["first_name", (parts: string[]) => parts[0]],
    ["last_name", (parts: string[]) => (parts.length > 1 ? parts[parts.length - 1] : undefined)],
  ] as const) {
    // A name part counts only if nobody else shares it.
    const owners = new Map<string, string[]>();
    for (const p of candidates) {
      const value = part(tokens(p.name));
      if (!value || value.length < 2) continue;
      owners.set(value, [...(owners.get(value) ?? []), p.id]);
    }
    const hits = [...owners.entries()].filter(([value, ids]) => set.has(value) && ids.length === 1);
    const result = pick(hits.map(([, ids]) => ids[0]), how);
    if (result) return result;
  }
  return NO_MATCH;
}

/** "Employee code: E012", "Emp No. 12", "Employee ID #E-7". */
const CODE_LABEL_RE =
  /\b(?:employee|emp\.?|staff|payroll)\s*(?:code|no\.?|number|id|#)\s*[:#.]?\s*([A-Za-z0-9][A-Za-z0-9_-]{0,19})/gi;

/** Payroll codes written next to a label in the PDF's text. */
export function codesInText(text: string): string[] {
  return [...text.matchAll(CODE_LABEL_RE)].map((m) => m[1]);
}

/** Whose payslip is this, going by the text inside the PDF? A labelled
 *  payroll code first, then a full name written as a phrase. */
export function matchByText(text: string, people: PayslipPerson[]): Match {
  const candidates = people;
  const codes = new Set(codesInText(text).map((c) => c.toUpperCase()));
  const byCode = candidates.filter((p) => p.payroll_code && codes.has(p.payroll_code.toUpperCase()));
  const code = pick(byCode.map((p) => p.id), "pdf_code");
  if (code) return code;

  const flat = ` ${tokens(text).join(" ")} `;
  const byName = candidates.filter((p) => {
    const parts = tokens(p.name);
    return parts.length > 1 && flat.includes(` ${parts.join(" ")} `);
  });
  return pick(longestNames(byName), "pdf_name") ?? NO_MATCH;
}

/** The owner (or an email's staff hint) chose this person. */
export function chosenMatch(staffId: string): Match {
  return found(staffId, "chosen");
}

/** Keep the first match that names someone; otherwise the one with
 *  candidates, so the owner sees who it could be. */
export function firstMatch(...matches: Match[]): Match {
  return (
    matches.find((m) => m.staffId) ?? matches.find((m) => m.candidates.length > 0) ?? NO_MATCH
  );
}

// ---- Pay runs -----------------------------------------------------------------------------------

export type PayRun = { payDate: string; periodStart: string; periodEnd: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parts(ymd: string): { y: number; m: string; d: number } {
  const [y, m, d] = ymd.split("-").map(Number);
  return { y, m: MONTHS[m - 1], d };
}

/** The pay period, short:
 *  "10 Nov", "10 to 16 Nov", "28 Nov to 4 Dec", "29 Dec 2026 to 4 Jan 2027". */
export function periodLabel(start: string, end: string): string {
  const a = parts(start);
  const b = parts(end);
  if (start === end) return `${a.d} ${a.m}`;
  if (a.y !== b.y) return `${a.d} ${a.m} ${a.y} to ${b.d} ${b.m} ${b.y}`;
  if (a.m !== b.m) return `${a.d} ${a.m} to ${b.d} ${b.m}`;
  return `${a.d} to ${b.d} ${a.m}`;
}

/** "Paid Fri 20 Nov, for 9 to 15 Nov" */
export function runLabel(run: PayRun): string {
  return `Paid ${shortYmd(run.payDate)}, for ${periodLabel(run.periodStart, run.periodEnd)}`;
}

/** The upload form's starting values: paid today, for last Monday to Sunday. */
export function defaultRun(today: string): PayRun {
  const lastMonday = addDays(weekStart(today), -7);
  return { payDate: today, periodStart: lastMonday, periodEnd: addDays(lastMonday, 6) };
}

/** Field errors for a pay run (empty object = fine). */
export function checkRun(run: PayRun): Partial<Record<keyof PayRun, string>> {
  const errors: Partial<Record<keyof PayRun, string>> = {};
  if (!isYmd(run.payDate)) errors.payDate = "Choose the pay date.";
  if (!isYmd(run.periodStart)) errors.periodStart = "Choose the first day of the period.";
  if (!isYmd(run.periodEnd)) errors.periodEnd = "Choose the last day of the period.";
  if (errors.periodStart || errors.periodEnd) return errors;
  if (run.periodEnd < run.periodStart) {
    errors.periodEnd = "The period can't end before it starts.";
  } else if (Date.parse(run.periodEnd) - Date.parse(run.periodStart) >= MAX_PERIOD_DAYS * 86_400_000) {
    errors.periodEnd = `A pay period is at most ${MAX_PERIOD_DAYS} days.`;
  }
  return errors;
}

// ---- Files -----------------------------------------------------------------------------------------

/** Error for a file the bucket would refuse, or null. Some browsers give a
 *  dragged PDF no type, so the .pdf name counts too. */
export function checkPayslipFile(file: { name: string; type: string; size: number }): string | null {
  const isPdf = file.type === "application/pdf" || (file.type === "" && /\.pdf$/i.test(file.name));
  if (!isPdf) return "Only PDF payslips.";
  if (file.size === 0) return "That file is empty.";
  if (file.size > PAYSLIP_MAX_BYTES) return "That PDF is over 2 MB.";
  return null;
}

/** A real PDF starts with "%PDF-" (allowing a little junk before it, as
 *  readers do). Checked on the server: the browser's type can be wrong. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  const head = String.fromCharCode(...bytes.subarray(0, 1024));
  return head.includes("%PDF-");
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PATH_RE = new RegExp(`^(${UUID})/(\\d{4}-\\d{2}-\\d{2})-${UUID}\\.pdf$`);

/** {staff_id}/{pay_date}-{uuid}.pdf, as the migration requires. */
export function payslipPath(staffId: string, payDate: string, fileId: string): string {
  return `${staffId}/${payDate}-${fileId}.pdf`;
}

export function isPayslipPath(path: string): boolean {
  const m = PATH_RE.exec(path);
  return Boolean(m && isYmd(m[2]));
}

/** "payslip-2026-11-20.pdf", or "payslip-hemi-te-rangi-2026-11-20.pdf"
 *  when the owner downloads someone's to send it on. */
export function downloadName(payDate: string, name?: string): string {
  const who = name ? tokens(name).join("-") : "";
  return who ? `payslip-${who}-${payDate}.pdf` : `payslip-${payDate}.pdf`;
}

export function checkPayrollCode(value: string): { ok: true; code: string | null } | { ok: false; error: string } {
  const code = value.trim();
  if (!code) return { ok: true, code: null };
  if (!PAYROLL_CODE_RE.test(code)) {
    return { ok: false, error: "A payroll code is up to 20 letters, numbers, - or _ (no spaces)." };
  }
  return { ok: true, code };
}

export function checkWithdrawReason(value: string): { ok: true; reason: string } | { ok: false; error: string } {
  const reason = value.trim().replace(/\s+/g, " ");
  if (!reason) return { ok: false, error: "Say why it's withdrawn, for example \"Wrong hours\"." };
  if (reason.length > WITHDRAW_REASON_MAX) return { ok: false, error: `Keep it under ${WITHDRAW_REASON_MAX} characters.` };
  return { ok: true, reason };
}

// ---- The owner's list of pay runs ---------------------------------------------------------------------

export type PayslipRow = {
  id: string;
  staff_id: string;
  pay_date: string;
  period_start: string;
  period_end: string;
  published_at: string | null;
  viewed_at: string | null;
  withdrawn_at: string | null;
};

export type PayslipState = "draft" | "published" | "viewed" | "withdrawn";

export function payslipState(row: Pick<PayslipRow, "published_at" | "viewed_at" | "withdrawn_at">): PayslipState {
  if (row.withdrawn_at) return "withdrawn";
  if (row.viewed_at) return "viewed";
  if (row.published_at) return "published";
  return "draft";
}

export const STATE_LABELS: Record<PayslipState, string> = {
  draft: "Not published",
  published: "Not opened yet",
  viewed: "Opened",
  withdrawn: "Withdrawn",
};

export type RunGroup<R extends PayslipRow> = PayRun & {
  key: string;
  rows: R[];
  drafts: number;
  published: number;
  viewed: number;
  withdrawn: number;
};

export function runKey(run: PayRun): string {
  return `${run.payDate}|${run.periodStart}|${run.periodEnd}`;
}

/** Payslips grouped by pay run, newest pay date first; rows by name. */
export function groupRuns<R extends PayslipRow>(rows: R[], nameOf: (staffId: string) => string): RunGroup<R>[] {
  const groups = new Map<string, RunGroup<R>>();
  for (const row of rows) {
    const run = { payDate: row.pay_date, periodStart: row.period_start, periodEnd: row.period_end };
    const key = runKey(run);
    let group = groups.get(key);
    if (!group) {
      group = { ...run, key, rows: [], drafts: 0, published: 0, viewed: 0, withdrawn: 0 };
      groups.set(key, group);
    }
    group.rows.push(row);
    const state = payslipState(row);
    if (state === "draft") group.drafts += 1;
    if (state === "published" || state === "viewed") group.published += 1;
    if (state === "viewed") group.viewed += 1;
    if (state === "withdrawn") group.withdrawn += 1;
  }
  const order = (s: PayslipState) => (s === "withdrawn" ? 1 : 0);
  for (const group of groups.values()) {
    group.rows.sort(
      (a, b) =>
        order(payslipState(a)) - order(payslipState(b)) || nameOf(a.staff_id).localeCompare(nameOf(b.staff_id)),
    );
  }
  return [...groups.values()].sort(
    (a, b) => b.payDate.localeCompare(a.payDate) || b.periodStart.localeCompare(a.periodStart),
  );
}

/** "8 published, 5 opened, 1 not published" */
export function runSummary(group: Pick<RunGroup<PayslipRow>, "drafts" | "published" | "viewed">): string {
  const bits = [`${group.published} published`, `${group.viewed} opened`];
  if (group.drafts > 0) bits.push(`${group.drafts} not published`);
  return bits.join(", ");
}

// ---- Notification --------------------------------------------------------------------------------------

export function payslipMessage(payslip: { id: string; period_start: string; period_end: string }): PushMessage {
  return {
    title: "Payslip ready",
    body: `Your payslip for ${periodLabel(payslip.period_start, payslip.period_end)} is ready`,
    url: "/payslips",
    tag: `payslip-${payslip.id}`,
  };
}
