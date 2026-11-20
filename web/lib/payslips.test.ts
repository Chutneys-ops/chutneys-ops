import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  baseName,
  checkPayrollCode,
  checkPayslipFile,
  checkRun,
  checkWithdrawReason,
  codesInText,
  downloadName,
  defaultRun,
  firstMatch,
  groupRuns,
  isPayslipPath,
  looksLikePdf,
  matchByFileName,
  matchByText,
  matchText,
  NO_MATCH,
  PAYSLIP_MAX_BYTES,
  payslipMessage,
  payslipPath,
  payslipState,
  periodLabel,
  runLabel,
  runSummary,
  tokens,
  type PayslipPerson,
  type PayslipRow,
} from "./payslips.ts";

const ANA = "a0000000-0000-0000-0000-00000000000a";
const ANB = "b0000000-0000-0000-0000-00000000000b";
const MIA = "c0000000-0000-0000-0000-00000000000c";
const TOM = "e0000000-0000-0000-0000-00000000000e";
const HEMI = "f0000000-0000-0000-0000-00000000000f";

const people: PayslipPerson[] = [
  { id: ANA, name: "Ana Smith", payroll_code: "E012" },
  { id: ANB, name: "Ana Brown", payroll_code: "12" },
  { id: MIA, name: "Mia Wong", payroll_code: null },
  { id: TOM, name: "Tom Hart", payroll_code: "E099", active: false },
  { id: HEMI, name: "Hēmi Te Rangi", payroll_code: "E020" },
];

// ---- Words and names ----------------------------------------------------------------

test("tokens: lower case, no accents or macrons, split on anything else", () => {
  assert.deepEqual(tokens("Hēmi_Te-Rangi O'Brien (E012).PDF"), ["hemi", "te", "rangi", "o", "brien", "e012", "pdf"]);
  assert.deepEqual(tokens("  "), []);
});

test("baseName drops folders and the .pdf extension", () => {
  assert.equal(baseName("C:\\pay\\Ana Smith.PDF"), "Ana Smith");
  assert.equal(baseName("runs/2026/E012.pdf"), "E012");
  assert.equal(baseName("notes.pdf.txt"), "notes.pdf.txt");
});

// ---- Matching by file name -------------------------------------------------------------

test("payroll code in the file name wins, whatever the case", () => {
  assert.deepEqual(matchByFileName("Payslip_e012_2026-11-20.pdf", people), {
    staffId: ANA,
    how: "payroll_code",
    confidence: "high",
    candidates: [],
  });
});

test("a code must be a whole word: E0123 is not E012", () => {
  assert.equal(matchByFileName("E0123.pdf", people).staffId, null);
});

test("two codes in one name (a date that looks like a code) is ambiguous, not a guess", () => {
  const m = matchByFileName("E012 12.pdf", people);
  assert.equal(m.staffId, null);
  assert.deepEqual(m.candidates.sort(), [ANA, ANB].sort());
});

test("full name in any order and with any separators", () => {
  assert.equal(matchByFileName("smith-ana.pdf", people).staffId, ANA);
  assert.equal(matchByFileName("Hemi Te Rangi Nov.pdf", people).how, "full_name");
  assert.equal(matchByFileName("hēmi_te_rangi.pdf", people).staffId, HEMI);
});

test("the longest full name wins: 'Ana Smith' over a person called just 'Ana'", () => {
  const withAna = [...people, { id: "x", name: "Ana", payroll_code: null }];
  assert.equal(matchByFileName("ana smith.pdf", withAna).staffId, ANA);
});

test("first or last name only counts when nobody else shares it", () => {
  const mia = matchByFileName("Mia payslip.pdf", people);
  assert.equal(mia.staffId, MIA);
  assert.equal(mia.how, "first_name");
  assert.equal(mia.confidence, "medium");

  assert.equal(matchByFileName("Wong.pdf", people).how, "last_name");
  // Two people called Ana: no guess.
  assert.deepEqual(matchByFileName("ana.pdf", people), NO_MATCH);
});

test("turned-off people are matched too, so the owner can upload their final pay", () => {
  assert.equal(matchByFileName("E099 final pay.pdf", people).staffId, TOM);
  assert.equal(matchByFileName("Tom Hart.pdf", people).staffId, TOM);
  assert.equal(matchByText("Employee code: E099", people).staffId, TOM);
});

test("nothing recognisable: no match", () => {
  assert.deepEqual(matchByFileName("scan0001.pdf", people), NO_MATCH);
});

// ---- Matching by the PDF's text ----------------------------------------------------------

test("codesInText finds labelled codes only", () => {
  assert.deepEqual(codesInText("Employee Code: E012\nEmp No. 12\nEmployee ID #E-7"), ["E012", "12", "E-7"]);
  assert.deepEqual(codesInText("Hours 12 Rate 25.50"), []);
});

test("text: a labelled payroll code, then the full name as a phrase", () => {
  const byCode = matchByText("CHUTNEYS LTD\nPay advice\nEmployee code: e020\nGross 812.40", people);
  assert.equal(byCode.staffId, HEMI);
  assert.equal(byCode.how, "pdf_code");

  const byName = matchByText("Pay advice for MIA WONG\nPeriod 9 Nov to 15 Nov", people);
  assert.equal(byName.staffId, MIA);
  assert.equal(byName.confidence, "medium");

  // Words scattered around the page aren't a name.
  assert.deepEqual(matchByText("Mia worked at the Wong St truck", people), NO_MATCH);
});

test("firstMatch keeps the first match that names someone, else the ambiguous one", () => {
  const ambiguous = { ...NO_MATCH, candidates: [ANA, ANB] };
  const mia = matchByFileName("mia.pdf", people);
  assert.equal(firstMatch(NO_MATCH, mia), mia);
  assert.equal(firstMatch(ambiguous, mia), mia);
  assert.equal(firstMatch(NO_MATCH, ambiguous), ambiguous);
  assert.equal(firstMatch(NO_MATCH, NO_MATCH), NO_MATCH);
});

test("matchText explains the match", () => {
  const names = new Map([[ANA, "Ana Smith"], [ANB, "Ana Brown"]]);
  assert.equal(matchText(matchByFileName("E012.pdf", people)), "Payroll code in the file name");
  assert.equal(matchText({ ...NO_MATCH, candidates: [ANA, ANB] }, names), "2 people match: Ana Smith, Ana Brown");
  assert.equal(matchText(NO_MATCH), "No one matched");
});

// ---- Pay runs ------------------------------------------------------------------------------

test("period labels: same month, across months, across years, one day", () => {
  assert.equal(periodLabel("2026-11-10", "2026-11-16"), "10 to 16 Nov");
  assert.equal(periodLabel("2026-11-28", "2026-12-04"), "28 Nov to 4 Dec");
  assert.equal(periodLabel("2026-12-29", "2027-01-04"), "29 Dec 2026 to 4 Jan 2027");
  assert.equal(periodLabel("2026-09-01", "2026-09-30"), "1 to 30 Sep");
  assert.equal(periodLabel("2026-11-10", "2026-11-10"), "10 Nov");
});

test("runLabel", () => {
  assert.equal(
    runLabel({ payDate: "2026-11-20", periodStart: "2026-11-09", periodEnd: "2026-11-15" }),
    "Paid Fri 20 Nov, for 9 to 15 Nov",
  );
});

test("defaultRun: paid today, for last Monday to Sunday", () => {
  // Friday 20 Nov 2026 -> 9 to 15 Nov.
  assert.deepEqual(defaultRun("2026-11-20"), { payDate: "2026-11-20", periodStart: "2026-11-09", periodEnd: "2026-11-15" });
  // On a Monday, the week that just ended.
  assert.deepEqual(defaultRun("2026-11-16"), { payDate: "2026-11-16", periodStart: "2026-11-09", periodEnd: "2026-11-15" });
});

test("checkRun", () => {
  assert.deepEqual(checkRun({ payDate: "2026-11-20", periodStart: "2026-11-09", periodEnd: "2026-11-15" }), {});
  assert.ok(checkRun({ payDate: "", periodStart: "2026-11-09", periodEnd: "2026-11-15" }).payDate);
  assert.ok(checkRun({ payDate: "2026-11-20", periodStart: "2026-02-30", periodEnd: "2026-11-15" }).periodStart);
  assert.match(
    checkRun({ payDate: "2026-11-20", periodStart: "2026-11-15", periodEnd: "2026-11-09" }).periodEnd ?? "",
    /before it starts/,
  );
  // A month is fine (end - start = 31 days), longer isn't: same as the database.
  assert.deepEqual(checkRun({ payDate: "2026-11-01", periodStart: "2026-10-01", periodEnd: "2026-11-01" }), {});
  assert.ok(checkRun({ payDate: "2026-11-02", periodStart: "2026-10-01", periodEnd: "2026-11-02" }).periodEnd);
});

test("the period limit matches the migration", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20261207000000_payslips.sql", import.meta.url), "utf8");
  assert.match(sql, /payslips_period_length check \(period_end - period_start <= 31\)/);
  assert.match(sql, /file_size_limit, allowed_mime_types\)\s+values \('payslips', 'payslips', false, 2097152,/);
  assert.equal(PAYSLIP_MAX_BYTES, 2097152);
});

// ---- Files -----------------------------------------------------------------------------------

test("checkPayslipFile: PDFs up to 2 MB only", () => {
  assert.equal(checkPayslipFile({ name: "a.pdf", type: "application/pdf", size: 1000 }), null);
  assert.equal(checkPayslipFile({ name: "a.PDF", type: "", size: 1000 }), null);
  assert.match(checkPayslipFile({ name: "a.jpg", type: "image/jpeg", size: 1000 }) ?? "", /Only PDF/);
  assert.match(checkPayslipFile({ name: "a.pdf", type: "application/pdf", size: 0 }) ?? "", /empty/);
  assert.match(checkPayslipFile({ name: "a.pdf", type: "application/pdf", size: PAYSLIP_MAX_BYTES + 1 }) ?? "", /2 MB/);
});

test("looksLikePdf checks the bytes, not the name", () => {
  const enc = new TextEncoder();
  assert.ok(looksLikePdf(enc.encode("%PDF-1.7\n...")));
  assert.ok(looksLikePdf(enc.encode("\uFEFF%PDF-1.4")));
  assert.ok(!looksLikePdf(enc.encode("<html>not a pdf</html>")));
  assert.ok(!looksLikePdf(new Uint8Array()));
});

test("payslip paths: {staff_id}/{pay_date}-{uuid}.pdf", () => {
  const path = payslipPath(ANA, "2026-11-20", "11111111-1111-4111-8111-111111111111");
  assert.equal(path, `${ANA}/2026-11-20-11111111-1111-4111-8111-111111111111.pdf`);
  assert.ok(isPayslipPath(path));
  assert.ok(!isPayslipPath(`${ANA}/2026-02-30-11111111-1111-4111-8111-111111111111.pdf`));
  assert.ok(!isPayslipPath(`../${path}`));
  assert.ok(!isPayslipPath(`${ANA}/2026-11-20.pdf`));
});

test("download names", () => {
  assert.equal(downloadName("2026-11-20"), "payslip-2026-11-20.pdf");
  assert.equal(downloadName("2026-11-20", "Hēmi Te Rangi"), "payslip-hemi-te-rangi-2026-11-20.pdf");
  assert.equal(downloadName("2026-11-20", "O'Brien, Sam"), "payslip-o-brien-sam-2026-11-20.pdf");
});

test("payroll codes and withdraw reasons", () => {
  assert.deepEqual(checkPayrollCode("  E012 "), { ok: true, code: "E012" });
  assert.deepEqual(checkPayrollCode(""), { ok: true, code: null });
  assert.equal(checkPayrollCode("E 012").ok, false);
  assert.equal(checkPayrollCode("-12").ok, false);
  assert.equal(checkPayrollCode("x".repeat(21)).ok, false);

  assert.deepEqual(checkWithdrawReason("  Wrong   hours "), { ok: true, reason: "Wrong hours" });
  assert.equal(checkWithdrawReason("  ").ok, false);
  assert.equal(checkWithdrawReason("x".repeat(301)).ok, false);
});

test("the payroll code rule matches the migration", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20261207000000_payslips.sql", import.meta.url), "utf8");
  assert.ok(sql.includes("payroll_code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,19}$'"));
});

// ---- Pay run list ------------------------------------------------------------------------------

function row(id: string, staff: string, run: string, state: Partial<PayslipRow> = {}): PayslipRow {
  const [pay_date, period_start, period_end] = run.split("|");
  return { id, staff_id: staff, pay_date, period_start, period_end, published_at: null, viewed_at: null, withdrawn_at: null, ...state };
}

test("payslipState", () => {
  assert.equal(payslipState({ published_at: null, viewed_at: null, withdrawn_at: null }), "draft");
  assert.equal(payslipState({ published_at: "t", viewed_at: null, withdrawn_at: null }), "published");
  assert.equal(payslipState({ published_at: "t", viewed_at: "t", withdrawn_at: null }), "viewed");
  assert.equal(payslipState({ published_at: "t", viewed_at: "t", withdrawn_at: "t" }), "withdrawn");
});

test("groupRuns: newest first, withdrawn last, then by name; counts", () => {
  const names = new Map([[ANA, "Ana Smith"], [MIA, "Mia Wong"], [ANB, "Ana Brown"]]);
  const nov20 = "2026-11-20|2026-11-09|2026-11-15";
  const nov13 = "2026-11-13|2026-11-02|2026-11-08";
  const groups = groupRuns(
    [
      row("1", MIA, nov13, { published_at: "t", viewed_at: "t" }),
      row("2", MIA, nov20, { published_at: "t" }),
      row("3", ANA, nov20, { published_at: "t", withdrawn_at: "t" }),
      row("4", ANA, nov20),
      row("5", ANB, nov20, { published_at: "t", viewed_at: "t" }),
    ],
    (id) => names.get(id) ?? "",
  );
  assert.deepEqual(groups.map((g) => g.payDate), ["2026-11-20", "2026-11-13"]);
  assert.deepEqual(groups[0].rows.map((r) => r.id), ["5", "4", "2", "3"]);
  assert.deepEqual(
    { drafts: groups[0].drafts, published: groups[0].published, viewed: groups[0].viewed, withdrawn: groups[0].withdrawn },
    { drafts: 1, published: 2, viewed: 1, withdrawn: 1 },
  );
  assert.equal(runSummary(groups[0]), "2 published, 1 opened, 1 not published");
  assert.equal(runSummary(groups[1]), "1 published, 1 opened");
});

test("the notification wording", () => {
  assert.deepEqual(payslipMessage({ id: "p1", period_start: "2026-11-10", period_end: "2026-11-16" }), {
    title: "Payslip ready",
    body: "Your payslip for 10 to 16 Nov is ready",
    url: "/payslips",
    tag: "payslip-p1",
  });
});
