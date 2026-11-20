// Verifier pack: every food safety record for a date range, arranged for the
// Auckland Council verifier. Pure helpers only (no React, no Supabase), so
// they run on the server and under `node --test`.
//
//   1. Ranges and months: which dates a pack covers, and last month's file.
//   2. Grouping: each sheet's entries become table rows, with follow-up
//      readings and corrections right under the entry they belong to.
//   3. Gaps: a required-daily record with nothing on a trading day is a
//      "No record" row, so missing days are visible instead of silently
//      absent. Days the site doesn't trade (sites.trading_days) are "Closed".
//   4. Sickness rows (no medical details), and every training record to date
//      for each person who worked in the range.
//   5. Page planning: the contents list, how many pages it takes, and
//      turning the page markers from the first PDF pass into page numbers.
//
// The PDF itself is drawn by lib/verifier-pack-pdf.tsx.

import { aucklandDate, aucklandTime } from "./dates.ts";
import {
  findOutOfRange,
  formatValue,
  groupEntries,
  type EntryLike,
  type EntryNode,
  type EntryValues,
  type RecordField,
  type UnitRanges,
} from "./records.ts";
import { isTradingDay } from "./trading-days.ts";
import { TOPIC_LABELS, type TrainingTopic } from "./training.ts";

export const BUSINESS_NAME = "Chutneys";
/** Private Storage bucket for the monthly copies (owner reads, server writes). */
export const PACK_BUCKET = "verifier-packs";
/** Longest range for a pack made on demand. Monthly copies cover the rest. */
export const MAX_PACK_DAYS = 92;
/** Contents lines per page. The contents are split by this, not by the PDF
 *  library, so their page count is known before the PDF is drawn. */
export const CONTENTS_PER_PAGE = 20;

// ---- 1. Ranges and months ---------------------------------------------------

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isYmd(value: unknown): value is string {
  if (typeof value !== "string" || !YMD_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Every date from `from` to `to`, both included. Works on plain dates, so
 *  daylight saving can't skip or repeat a day. */
export function datesInRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Days from `from` to `to`, both included. */
export function dayCount(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** null when the range is fine, otherwise what's wrong (shown on the page). */
export function rangeError(from: unknown, to: unknown, today: string, maxDays = MAX_PACK_DAYS): string | null {
  if (!isYmd(from) || !isYmd(to)) return "Choose a start and end date";
  if (from > to) return "The start date must be on or before the end date";
  if (to > today) return "The end date can't be in the future";
  if (dayCount(from, to) > maxDays) return `Choose ${maxDays} days or fewer (the monthly copies cover longer periods)`;
  return null;
}

/** The month before the one `today` is in: "2026-11-01" -> "2026-10". */
export function previousMonth(today: string): string {
  const [y, m] = today.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export function isMonth(value: unknown): value is string {
  return typeof value === "string" && MONTH_RE.test(value);
}

/** First and last date of a month: "2026-02" -> 2026-02-01 to 2026-02-28. */
export function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

/** Where a monthly copy is stored: "2026-10" -> "2026/2026-10.pdf". */
export function monthlyPackPath(month: string): string {
  return `${month.slice(0, 4)}/${month}.pdf`;
}

const MONTHLY_PATH_RE = /^(\d{4})\/(\d{4}-(0[1-9]|1[0-2]))\.pdf$/;

/** The month in a monthly copy's path, or null if it isn't one. The year
 *  folder must match, so "2025/2026-10.pdf" is refused. */
export function monthFromPackPath(path: string): string | null {
  const m = MONTHLY_PATH_RE.exec(path);
  return m && m[2].startsWith(m[1]) ? m[2] : null;
}

const monthLabelFormat = new Intl.DateTimeFormat("en-NZ", { timeZone: "UTC", month: "long", year: "numeric" });

/** "2026-10" -> "October 2026". */
export function monthLabel(month: string): string {
  return monthLabelFormat.format(new Date(`${month}-01T00:00:00Z`));
}

const longDateFormat = new Intl.DateTimeFormat("en-NZ", {
  timeZone: "UTC", // a plain date: UTC leaves it unchanged
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const shortDateFormat = new Intl.DateTimeFormat("en-NZ", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** "2026-11-20" -> "Friday 20 November 2026". */
export function longDate(ymd: string): string {
  return longDateFormat.format(new Date(`${ymd}T00:00:00Z`)).replace(",", "");
}

/** "2026-11-20" -> "20 Nov 2026". */
export function shortDate(ymd: string): string {
  return shortDateFormat.format(new Date(`${ymd}T00:00:00Z`));
}

/** "1 Oct 2026 to 31 Oct 2026". */
export function rangeLabel(from: string, to: string): string {
  return from === to ? shortDate(from) : `${shortDate(from)} to ${shortDate(to)}`;
}

/** A download name: "verifier-pack-food-truck-1-2026-10-01-to-2026-10-31.pdf". */
export function packFileName(siteName: string | null, from: string, to: string): string {
  const slug = (siteName ?? "all sites")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // "Māngere" -> "Mangere"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `verifier-pack-${slug || "site"}-${from}-to-${to}.pdf`;
}

// ---- Inputs (what lib/verifier-pack-data.ts loads) ----------------------------

type Named = { name: string } | null;

export type PackSite = {
  id: string;
  name: string;
  kind: string;
  active: boolean;
  created_at: string;
  /** ISO weekdays the site trades (1 = Monday ... 7 = Sunday). */
  trading_days: number[] | null;
};

export type PackTemplate = {
  code: string;
  title: string;
  period: "daily" | "event";
  required_daily: boolean;
  site_kinds: string[];
  sort_order: number;
  active: boolean;
  fields: RecordField[];
};

export type PackSheet = {
  id: string;
  site_id: string;
  template_code: string;
  sheet_date: string;
  signed_off_at: string | null;
  signer: Named;
};

export type PackEntry = EntryLike & {
  sheet_id: string;
  out_of_range: boolean;
  corrective_action: string | null;
  note: string | null;
  recorder: Named;
};

export type PackUnit = { id: string; site_id: string; name: string; min_c: number | null; max_c: number | null };

/** A vomiting or diarrhoea exclusion. Deliberately no reason, note,
 *  certificate or hours: the verifier sees the exclusion, not the illness. */
export type PackSickness = {
  start_date: string;
  cleared_to_work_at: string | null;
  person: Named;
  clearer: Named;
};

export type PackTraining = {
  trainee_id: string;
  topic: string;
  topic_detail: string | null;
  trained_on: string;
  trainer_signed_at: string;
  trainee_signed_at: string | null;
  trainee: Named;
  trainer: Named;
};

export type PackInput = {
  from: string;
  to: string;
  /** null = every site. */
  siteId: string | null;
  sites: PackSite[];
  templates: PackTemplate[];
  sheets: PackSheet[];
  entries: PackEntry[];
  units: PackUnit[];
  /** Days someone chose each site ("Choose site"), as Auckland dates. */
  siteDays: { site_id: string; date: string }[];
  sickness: PackSickness[];
  /** Everyone who chose a site or had a timesheet in the range (at the
   *  chosen site, for a one-site pack). */
  workers: { id: string; name: string }[];
  /** Their training records dated on or before `to` (any start date). */
  training: PackTraining[];
};

// ---- Output (what the PDF and the summary draw) -------------------------------

export type ValueCell = { label: string; text: string; out: boolean };

export type PackRow = {
  id: string;
  /** entry: an original entry; later: a follow-up reading (cooling, batter);
   *  correction: fixes the entry above it. */
  kind: "entry" | "later" | "correction";
  time: string;
  by: string;
  values: ValueCell[];
  outOfRange: boolean;
  correctiveAction: string | null;
  comment: string | null;
  /** "Correction of the 10:22 am entry", "Later reading for the 9:00 am entry". */
  relation: string | null;
};

export type PackDay =
  | { date: string; status: "recorded"; rows: PackRow[]; signedOff: { by: string; at: string } | null }
  | { date: string; status: "missing"; siteUsed: boolean }
  /** A day the site doesn't trade, with nothing recorded: not a gap. */
  | { date: string; status: "closed" };

export type SectionCounts = {
  entries: number;
  outOfRange: number;
  missingDays: number;
  closedDays: number;
  unsignedDays: number;
};

export type PackSection = {
  id: string;
  code: string;
  title: string;
  required: boolean;
  days: PackDay[];
  counts: SectionCounts;
};

export type PackPart = { id: string; site: PackSite; sections: PackSection[]; counts: SectionCounts };

export type SicknessRow = { name: string; dateSick: string; dateCleared: string | null; clearedBy: string | null };

export type TrainingRow = {
  topic: string;
  date: string;
  trainer: string;
  trainerSignedAt: string;
  traineeSignedAt: string | null;
};

/** One person who worked in the range, with all their training to date. */
export type TrainingPerson = { name: string; records: TrainingRow[] };

export type Pack = {
  from: string;
  to: string;
  allSites: boolean;
  parts: PackPart[];
  sickness: SicknessRow[];
  training: TrainingPerson[];
};

// ---- 2. Grouping ----------------------------------------------------------------

/** Clearer names for the event records in the pack. */
const SECTION_TITLES: Record<string, string> = {
  deliveries: "Supplier deliveries",
  maintenance: "Equipment and maintenance",
  incident: "Incidents",
  complaint: "Customer complaints",
};

export function sectionTitle(template: Pick<PackTemplate, "code" | "title">): string {
  return SECTION_TITLES[template.code] ?? template.title;
}

const nameOf = (n: Named, fallback = "Unknown") => n?.name ?? fallback;

function unitMaps(units: PackUnit[]): { names: Record<string, string>; ranges: UnitRanges } {
  const names: Record<string, string> = {};
  const ranges: UnitRanges = {};
  for (const u of units) {
    names[u.id] = u.name;
    ranges[u.id] = { min: u.min_c ?? undefined, max: u.max_c ?? undefined };
  }
  return { names, ranges };
}

function valueCells(
  fields: RecordField[],
  values: EntryValues,
  base: EntryValues,
  units: { names: Record<string, string>; ranges: UnitRanges },
): ValueCell[] {
  const out = new Set(findOutOfRange(fields, { ...base, ...values }, units.ranges));
  return fields
    .filter((f) => {
      const v = values[f.key];
      return v !== undefined && v !== null && !(typeof v === "string" && v.trim() === "");
    })
    .map((f) => ({ label: f.label, text: formatValue(f, values[f.key], units.names), out: out.has(f.key) }));
}

function toRow(
  entry: PackEntry,
  kind: PackRow["kind"],
  relation: string | null,
  fields: RecordField[],
  base: EntryValues,
  units: { names: Record<string, string>; ranges: UnitRanges },
): PackRow {
  const values = valueCells(fields, entry.values, base, units);
  return {
    id: entry.id,
    kind,
    time: aucklandTime(entry.recorded_at),
    by: nameOf(entry.recorder, "A team member"),
    values,
    // The database's flag is the record. A field can also be marked when
    // today's unit limits say so; either way the row is out of range.
    outOfRange: entry.out_of_range || values.some((v) => v.out),
    correctiveAction: entry.corrective_action?.trim() || null,
    comment: entry.note?.trim() || null,
    relation,
  };
}

/** One sheet's entries as table rows: each entry, then its corrections,
 *  then its later readings (each followed by their own corrections). */
export function sheetRows(entries: PackEntry[], fields: RecordField[], units: PackUnit[] = []): PackRow[] {
  const maps = unitMaps(units);
  const rows: PackRow[] = [];
  const pushNode = (node: EntryNode<PackEntry>, kind: "entry" | "later", base: EntryValues, rootTime: string) => {
    const time = aucklandTime(node.entry.recorded_at);
    rows.push(toRow(node.entry, kind, kind === "later" ? `Later reading for the ${rootTime} entry` : null, fields, base, maps));
    for (const c of node.corrections) {
      rows.push(toRow(c, "correction", `Correction of the ${time} entry`, fields, base, maps));
    }
  };
  for (const group of groupEntries(entries)) {
    const rootTime = aucklandTime(group.root.entry.recorded_at);
    pushNode(group.root, "entry", {}, rootTime);
    for (const f of group.followUps) pushNode(f, "later", group.root.entry.values, rootTime);
  }
  return rows;
}

function countSection(days: PackDay[]): SectionCounts {
  const c: SectionCounts = { entries: 0, outOfRange: 0, missingDays: 0, closedDays: 0, unsignedDays: 0 };
  for (const d of days) {
    if (d.status === "missing") {
      c.missingDays += 1;
      continue;
    }
    if (d.status === "closed") {
      c.closedDays += 1;
      continue;
    }
    c.entries += d.rows.length;
    c.outOfRange += d.rows.filter((r) => r.outOfRange).length;
    if (!d.signedOff) c.unsignedDays += 1;
  }
  return c;
}

function addCounts(a: SectionCounts, b: SectionCounts): SectionCounts {
  return {
    entries: a.entries + b.entries,
    outOfRange: a.outOfRange + b.outOfRange,
    missingDays: a.missingDays + b.missingDays,
    closedDays: a.closedDays + b.closedDays,
    unsignedDays: a.unsignedDays + b.unsignedDays,
  };
}

const ZERO: SectionCounts = { entries: 0, outOfRange: 0, missingDays: 0, closedDays: 0, unsignedDays: 0 };

// ---- 3. Gaps ----------------------------------------------------------------------

/** Must this template be filled in at this site every day? */
export function isRequiredAt(template: PackTemplate, site: Pick<PackSite, "kind">): boolean {
  return template.active && template.required_daily && template.site_kinds.includes(site.kind);
}

/** The days a required record should have entries: every day in the range
 *  from the day the site was added (Auckland date) up to `to`. */
export function expectedDays(site: Pick<PackSite, "created_at">, from: string, to: string): string[] {
  const opened = aucklandDate(new Date(site.created_at));
  return datesInRange(opened > from ? opened : from, to);
}

/** Dates (from `expected`) with no entries on a trading day: the gaps.
 *  Days the site doesn't trade are never gaps. */
export function findGaps(
  expected: string[],
  recordedDates: Iterable<string>,
  tradingDays: readonly number[] | null = null,
): string[] {
  const done = new Set(recordedDates);
  return expected.filter((d) => !done.has(d) && isTradingDay(tradingDays, d));
}

/** Order of sections in a site's part: daily records first (their sort
 *  order), then event records (deliveries, maintenance, incidents...). */
export function compareTemplates(a: PackTemplate, b: PackTemplate): number {
  if (a.period !== b.period) return a.period === "daily" ? -1 : 1;
  return a.sort_order - b.sort_order || a.title.localeCompare(b.title) || a.code.localeCompare(b.code);
}

// ---- Building the whole pack -------------------------------------------------------

/** Arrange everything loaded for a range into the pack's parts and sections. */
export function buildPack(input: PackInput): Pack {
  const { from, to } = input;
  const templates = new Map(input.templates.map((t) => [t.code, t]));
  const entriesBySheet = new Map<string, PackEntry[]>();
  for (const e of input.entries) entriesBySheet.set(e.sheet_id, [...(entriesBySheet.get(e.sheet_id) ?? []), e]);
  const usedDays = new Set(input.siteDays.map((d) => `${d.site_id}|${d.date}`));

  const sites = input.sites
    .filter((s) => !input.siteId || s.id === input.siteId)
    .sort((a, b) => a.name.localeCompare(b.name));

  const parts: PackPart[] = [];
  for (const site of sites) {
    const units = input.units.filter((u) => u.site_id === site.id);
    // Sheets with at least one entry in range, by template and date.
    const sheets = input.sheets.filter(
      (s) => s.site_id === site.id && s.sheet_date >= from && s.sheet_date <= to && (entriesBySheet.get(s.id)?.length ?? 0) > 0,
    );
    const codes = new Set(sheets.map((s) => s.template_code));
    // Required records, unless the site didn't exist yet during the range.
    if (site.active && expectedDays(site, from, to).length > 0) {
      for (const t of input.templates) if (isRequiredAt(t, site)) codes.add(t.code);
    }
    // A closed site with nothing in the range isn't in an all-sites pack.
    if (codes.size === 0 || (!site.active && sheets.length === 0 && !input.siteId)) continue;

    const sections: PackSection[] = [];
    const sectionTemplates = [...codes]
      .map((c) => templates.get(c))
      .filter((t): t is PackTemplate => Boolean(t))
      .sort(compareTemplates);

    for (const template of sectionTemplates) {
      // A closed site isn't expected to keep records, so it has no gaps.
      const required = site.active && isRequiredAt(template, site);
      const mine = sheets.filter((s) => s.template_code === template.code);
      const byDate = new Map(mine.map((s) => [s.sheet_date, s]));
      const dates = required
        ? [...new Set([...expectedDays(site, from, to), ...byDate.keys()])].sort()
        : [...byDate.keys()].sort();

      const days: PackDay[] = dates.map((date) => {
        const sheet = byDate.get(date);
        if (!sheet && !isTradingDay(site.trading_days, date)) return { date, status: "closed" };
        if (!sheet) return { date, status: "missing", siteUsed: usedDays.has(`${site.id}|${date}`) };
        return {
          date,
          status: "recorded",
          rows: sheetRows(entriesBySheet.get(sheet.id) ?? [], template.fields, units),
          signedOff: sheet.signed_off_at ? { by: nameOf(sheet.signer), at: sheet.signed_off_at } : null,
        };
      });
      sections.push({
        id: `sec-${site.id}-${template.code}`,
        code: template.code,
        title: sectionTitle(template),
        required,
        days,
        counts: countSection(days),
      });
    }
    parts.push({
      id: `site-${site.id}`,
      site,
      sections,
      counts: sections.reduce((acc, s) => addCounts(acc, s.counts), ZERO),
    });
  }

  return {
    from,
    to,
    allSites: !input.siteId,
    parts,
    sickness: sicknessRows(input.sickness, from, to),
    training: trainingByPerson(input.workers, input.training, to),
  };
}

/** Totals across every site, for the cover and the on-screen summary. */
export function packTotals(pack: Pack): SectionCounts {
  return pack.parts.reduce((acc, p) => addCounts(acc, p.counts), ZERO);
}

// ---- 4. Sickness and training -----------------------------------------------------------

/** Exclusions that overlap the range: started on or before `to`, and not
 *  cleared before `from` (still excluded counts too). Oldest first. */
export function sicknessRows(rows: PackSickness[], from: string, to: string): SicknessRow[] {
  return rows
    .filter((r) => r.start_date <= to)
    .map((r) => ({ r, cleared: r.cleared_to_work_at ? aucklandDate(new Date(r.cleared_to_work_at)) : null }))
    .filter(({ cleared }) => cleared === null || cleared >= from)
    .sort((a, b) => a.r.start_date.localeCompare(b.r.start_date) || nameOf(a.r.person).localeCompare(nameOf(b.r.person)))
    .map(({ r, cleared }) => ({
      name: nameOf(r.person),
      dateSick: r.start_date,
      dateCleared: cleared,
      clearedBy: r.clearer?.name ?? null,
    }));
}

export function topicText(topic: string, detail: string | null): string {
  const label = TOPIC_LABELS[topic as TrainingTopic] ?? topic;
  return detail?.trim() ? `${label}: ${detail.trim()}` : label;
}

/**
 * Everyone who worked in the range (chose a site or had a timesheet), by
 * name, each with all their training dated on or before `to`, oldest first.
 * Someone with no training still gets a line, so the verifier sees it.
 */
export function trainingByPerson(
  workers: { id: string; name: string }[],
  rows: PackTraining[],
  to: string,
): TrainingPerson[] {
  const people = new Map<string, string>();
  for (const w of workers) people.set(w.id, w.name);
  return [...people]
    .sort(([, a], [, b]) => a.localeCompare(b))
    .map(([id, name]) => ({
      name,
      records: rows
        .filter((r) => r.trainee_id === id && r.trained_on <= to)
        .sort((a, b) => a.trained_on.localeCompare(b.trained_on) || a.topic.localeCompare(b.topic))
        .map((r) => ({
          topic: topicText(r.topic, r.topic_detail),
          date: r.trained_on,
          trainer: nameOf(r.trainer),
          trainerSignedAt: r.trainer_signed_at,
          traineeSignedAt: r.trainee_signed_at,
        })),
    }));
}

// ---- 5. Page planning -------------------------------------------------------------------

export type ContentsItem = { id: string; level: 0 | 1; title: string; note: string };

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "31 entries · 2 out of range · 3 days with no record". */
export function countsNote(c: SectionCounts): string {
  const bits = [plural(c.entries, "entry", "entries")];
  if (c.outOfRange) bits.push(`${c.outOfRange} out of range`);
  if (c.missingDays) bits.push(`${plural(c.missingDays, "day")} with no record`);
  if (c.closedDays) bits.push(`${c.closedDays} closed`);
  return bits.join(" · ");
}

export const SICKNESS_ID = "sickness";
export const TRAINING_ID = "training";

/** Every line of the contents, in document order. */
export function contentsItems(pack: Pack): ContentsItem[] {
  const items: ContentsItem[] = [];
  for (const part of pack.parts) {
    items.push({
      id: part.id,
      level: 0,
      title: part.site.active ? part.site.name : `${part.site.name} (closed)`,
      note: countsNote(part.counts),
    });
    for (const s of part.sections) items.push({ id: s.id, level: 1, title: s.title, note: countsNote(s.counts) });
  }
  items.push({
    id: SICKNESS_ID,
    level: 0,
    title: "Staff sickness (food safety exclusions)",
    note: plural(pack.sickness.length, "person", "people"),
  });
  items.push({
    id: TRAINING_ID,
    level: 0,
    title: "Training records",
    note: `${plural(pack.training.length, "person", "people")} · ${plural(
      pack.training.reduce((n, p) => n + p.records.length, 0),
      "record",
    )}`,
  });
  return items;
}

/** The contents split into pages of CONTENTS_PER_PAGE lines (at least one page). */
export function contentsPages<T>(items: T[], perPage = CONTENTS_PER_PAGE): T[][] {
  if (items.length === 0) return [[]];
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += perPage) pages.push(items.slice(i, i + perPage));
  return pages;
}

/** Page where the records start: after the cover (page 1) and the contents. */
export function firstBodyPage(contentsItemCount: number, perPage = CONTENTS_PER_PAGE): number {
  return 2 + contentsPages(new Array(contentsItemCount).fill(0), perPage).length;
}

/**
 * The PDF is drawn twice. The first pass records the page each section
 * heading lands on ("markers"). The second pass prints those numbers in the
 * contents. Because the contents always take the same number of pages, the
 * second pass lays out exactly like the first. This turns markers into the
 * numbers to print, with null for anything not found (printed as a dash).
 */
export function pageRefs(items: ContentsItem[], markers: Record<string, number>): Record<string, number | null> {
  return Object.fromEntries(items.map((i) => [i.id, Number.isInteger(markers[i.id]) ? markers[i.id] : null]));
}

/** Did two passes put every section on the same page? */
export function sameMarkers(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if (a[k] !== b[k]) return false;
  return true;
}

// ---- On-screen summary ----------------------------------------------------------------

export type SummaryLine = { id: string; name: string; counts: SectionCounts; missing: { title: string; days: number }[] };

/** Per site: totals, and which required records have days with no record. */
export function packSummary(pack: Pack): SummaryLine[] {
  return pack.parts.map((p) => ({
    id: p.site.id,
    name: p.site.active ? p.site.name : `${p.site.name} (closed)`,
    counts: p.counts,
    missing: p.sections.filter((s) => s.counts.missingDays > 0).map((s) => ({ title: s.title, days: s.counts.missingDays })),
  }));
}
