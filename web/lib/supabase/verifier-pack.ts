// Loads everything a verifier pack needs for a date range.
//
// It takes whichever client it's given:
//   - More > Verifier pack passes the manager's own session, so RLS decides
//     what's in the pack (managers and the owner see every site);
//   - the monthly job passes the admin client (there's no signed-in person;
//     the cron secret is the check).
//
// Big ranges can pass the API's 1,000-row limit, so every list is read in
// pages. Training: everyone who chose a site or had a timesheet in the range
// (at the chosen site, for a one-site pack), with all their training up to
// the end date. The arranging (grouping, gaps) is in lib/verifier-pack.ts (tested).

import type { SupabaseClient } from "@supabase/supabase-js";
import { aucklandDate } from "@/lib/dates";
import type {
  PackEntry,
  PackInput,
  PackSheet,
  PackSickness,
  PackSite,
  PackTemplate,
  PackTraining,
  PackUnit,
} from "@/lib/verifier-pack";

const PAGE = 1000;
/** Sheet ids per entries request (keeps the URL well under limits). */
const IDS_PER_REQUEST = 150;

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/** Read every row, PAGE at a time. `query(from, to)` must have a stable order. */
async function readAll<T>(query: (from: number, to: number) => Page<T>): Promise<T[]> {
  const rows: T[] = [];
  for (let start = 0; ; start += PAGE) {
    const { data, error } = await query(start, start + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** A plain date moved by whole days ("2026-11-01", -1 -> "2026-10-31"). */
function shift(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function loadPackInput(
  supabase: SupabaseClient,
  { siteId, from, to }: { siteId: string | null; from: string; to: string },
): Promise<PackInput> {
  // Auckland is 12 or 13 hours ahead of UTC, so a day either side of the
  // range in UTC covers every Auckland instant in it. Exact dates are
  // checked after converting (siteDays, sicknessRows).
  const fromInstant = `${shift(from, -1)}T00:00:00Z`;
  const toInstant = `${shift(to, 2)}T00:00:00Z`;

  const [sites, templates, sheets, units, shifts, timesheets, sickness] = await Promise.all([
    readAll<PackSite>((a, b) => {
      let q = supabase.from("sites").select("id, name, kind, active, created_at, trading_days");
      if (siteId) q = q.eq("id", siteId);
      return q.order("id").range(a, b);
    }),
    readAll<PackTemplate>((a, b) =>
      supabase
        .from("record_templates")
        .select("code, title, period, required_daily, site_kinds, sort_order, active, fields")
        .order("code")
        .range(a, b),
    ),
    readAll<PackSheet>((a, b) => {
      let q = supabase
        .from("record_sheets")
        .select("id, site_id, template_code, sheet_date, signed_off_at, signer:staff!signed_off_by(name)")
        .gte("sheet_date", from)
        .lte("sheet_date", to);
      if (siteId) q = q.eq("site_id", siteId);
      return q.order("id").range(a, b) as unknown as Page<PackSheet>;
    }),
    readAll<PackUnit>((a, b) => {
      let q = supabase.from("temp_units").select("id, site_id, name, min_c, max_c");
      if (siteId) q = q.eq("site_id", siteId);
      return q.order("id").range(a, b);
    }),
    // Site choices: which days a site was used, and who worked.
    readAll<{ site_id: string; staff_id: string; clock_in: string; person: { name: string } | null }>((a, b) => {
      let q = supabase
        .from("shifts")
        .select("site_id, staff_id, clock_in, person:staff!staff_id(name)")
        .gte("clock_in", fromInstant)
        .lt("clock_in", toInstant);
      if (siteId) q = q.eq("site_id", siteId);
      return q.order("id").range(a, b) as unknown as Page<{
        site_id: string;
        staff_id: string;
        clock_in: string;
        person: { name: string } | null;
      }>;
    }),
    // Timesheets: also who worked (hours entered without choosing a site).
    readAll<{ staff_id: string; person: { name: string } | null }>((a, b) => {
      let q = supabase
        .from("timesheets")
        .select("staff_id, person:staff!staff_id(name)")
        .gte("work_date", from)
        .lte("work_date", to);
      if (siteId) q = q.eq("site_id", siteId);
      return q.order("id").range(a, b) as unknown as Page<{ staff_id: string; person: { name: string } | null }>;
    }),
    // Only the columns the sickness record needs: no reason, note, hours
    // or certificate. Only vomiting or diarrhoea exclusions.
    readAll<PackSickness>(
      (a, b) =>
        supabase
          .from("leave_requests")
          .select("start_date, cleared_to_work_at, person:staff!staff_id(name), clearer:staff!cleared_by(name)")
          .eq("gi_symptoms", true)
          .lte("start_date", to)
          .or(`cleared_to_work_at.is.null,cleared_to_work_at.gte.${fromInstant}`)
          .order("id")
          .range(a, b) as unknown as Page<PackSickness>,
    ),
  ]);

  // Who worked in the range: chose a site (that day in Auckland) or had a
  // timesheet. Their training is listed in full.
  const workerNames = new Map<string, string>();
  for (const s of shifts) {
    const day = aucklandDate(new Date(s.clock_in));
    if (day >= from && day <= to) workerNames.set(s.staff_id, s.person?.name ?? "Unknown");
  }
  for (const t of timesheets) workerNames.set(t.staff_id, t.person?.name ?? "Unknown");
  const workers = [...workerNames].map(([id, name]) => ({ id, name }));

  // All their training up to the end of the range, whenever it was given.
  const training: PackTraining[] = [];
  for (const ids of chunks(
    workers.map((w) => w.id),
    IDS_PER_REQUEST,
  )) {
    training.push(
      ...(await readAll<PackTraining>(
        (a, b) =>
          supabase
            .from("training_records")
            .select(
              "trainee_id, topic, topic_detail, trained_on, trainer_signed_at, trainee_signed_at, " +
                "trainee:staff!trainee_id(name), trainer:staff!trainer_id(name)",
            )
            .in("trainee_id", ids)
            .lte("trained_on", to)
            .order("id")
            .range(a, b) as unknown as Page<PackTraining>,
      )),
    );
  }

  const entries: PackEntry[] = [];
  for (const ids of chunks(
    sheets.map((s) => s.id),
    IDS_PER_REQUEST,
  )) {
    entries.push(
      ...(await readAll<PackEntry>(
        (a, b) =>
          supabase
            .from("record_entries")
            .select(
              "id, sheet_id, values, out_of_range, corrective_action, recorded_at, " +
                "amends_entry_id, continues_entry_id, note, recorder:staff!recorded_by(name)",
            )
            .in("sheet_id", ids)
            .order("id")
            .range(a, b) as unknown as Page<PackEntry>,
      )),
    );
  }

  const siteDays = shifts
    .map((s) => ({ site_id: s.site_id, date: aucklandDate(new Date(s.clock_in)) }))
    .filter((d) => d.date >= from && d.date <= to);

  return { from, to, siteId, sites, templates, sheets, entries, units, siteDays, sickness, workers, training };
}
