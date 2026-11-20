// Pure helpers for Home: the greeting, what's due today, and the managers'
// count cards. No React, no Supabase, so they run under `node --test`. The
// page fetches the data (under RLS) and hands it to these.

import { toCents } from "./purchases.ts";

const hourFormat = new Intl.DateTimeFormat("en-NZ", {
  timeZone: "Pacific/Auckland",
  hour: "numeric",
  hourCycle: "h23",
});

/** The hour (0-23) in Auckland. */
export function aucklandHour(now: Date = new Date()): number {
  return Number(hourFormat.format(now));
}

/** "Good morning" (5 am to noon), "Good afternoon" (noon to 5 pm),
 *  "Good evening" (5 pm to 5 am), by Auckland time. */
export function greeting(now: Date = new Date()): string {
  const hour = aucklandHour(now);
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  return "Good evening";
}

/** "Ana" from "Ana Patel": greet people by their first name. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

// ---- Due today ----------------------------------------------------------------------

export type TemplateLite = { code: string; title: string; required_daily: boolean };
export type SheetLite = { template_code: string; entry_count: number };

/** Records that must be done every day (record_templates.required_daily:
 *  fridge temperatures, opening checks, cleaning) with no entry yet today at
 *  your site, in template order. The rest (cooking, cooling, deliveries...)
 *  are only filled in when they happen, so they're never "due". */
export function dueToday(templates: TemplateLite[], sheets: SheetLite[]): TemplateLite[] {
  const started = new Set(sheets.filter((s) => s.entry_count > 0).map((s) => s.template_code));
  return templates.filter((t) => t.required_daily && !started.has(t.code));
}

// ---- Count cards (managers and owner) -------------------------------------------------

export type ManagerCounts = {
  timesheetsToApprove: number;
  leaveWaiting: number;
  outOfRangeToday: number;
  notSignedOffToday: number;
  staffToClear: number;
};

export type CountCard = { key: keyof ManagerCounts; text: string; href: string; urgent: boolean };

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** One card per non-zero count, most urgent (food safety) first. */
export function countCards(counts: ManagerCounts): CountCard[] {
  const cards: CountCard[] = [
    {
      key: "staffToClear",
      text: `${plural(counts.staffToClear, "person", "people")} to clear after illness`,
      href: "/leave/sickness",
      urgent: true,
    },
    {
      key: "outOfRangeToday",
      text: `${plural(counts.outOfRangeToday, "out-of-range reading", "out-of-range readings")} today`,
      href: "/records",
      urgent: true,
    },
    {
      key: "notSignedOffToday",
      text: `${plural(counts.notSignedOffToday, "sheet", "sheets")} not signed off today`,
      href: "/records",
      urgent: false,
    },
    {
      key: "timesheetsToApprove",
      text: `${plural(counts.timesheetsToApprove, "timesheet", "timesheets")} to approve`,
      href: "/time",
      urgent: false,
    },
    {
      key: "leaveWaiting",
      text: `${plural(counts.leaveWaiting, "leave request", "leave requests")} waiting`,
      href: "/leave/requests",
      urgent: false,
    },
  ];
  return cards.filter((card) => counts[card.key] > 0);
}

// ---- Money ----------------------------------------------------------------------------

/** Total and GST of purchases, in cents (whole numbers, no float drift). */
export function sumPurchases(rows: { total_incl_gst: number | string; gst_amount: number | string }[]): {
  count: number;
  totalCents: number;
  gstCents: number;
} {
  return rows.reduce(
    (sum, r) => ({
      count: sum.count + 1,
      totalCents: sum.totalCents + toCents(r.total_incl_gst),
      gstCents: sum.gstCents + toCents(r.gst_amount),
    }),
    { count: 0, totalCents: 0, gstCents: 0 },
  );
}
