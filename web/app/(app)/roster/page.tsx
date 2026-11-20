import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { NotStaff } from "@/components/not-staff";
import { hoursText } from "@/lib/breaks";
import { aucklandDate, aucklandShortDay, aucklandTime } from "@/lib/dates";
import { shortYmd } from "@/lib/leave";
import {
  addDays,
  groupByDay,
  rosterTotals,
  shiftTimesText,
  splitWarnings,
  warningText,
  weekDays,
  weekFromParam,
  weekRangeText,
  weekState,
  type RosterShiftLite,
} from "@/lib/roster";
import { loadWarnings } from "@/lib/supabase/roster";
import { createClient } from "@/lib/supabase/server";
import { getCurrentShift, getSession, isManager } from "@/lib/supabase/session";
import { hhmm } from "@/lib/timesheets";
import { ActionButton } from "../time/small-actions";
import { copyLastWeek, deleteShift, publishWeek, saveShift } from "./actions";
import { ShiftForm } from "./shift-form";

type WeekRow = {
  id: string;
  published_at: string | null;
  changed_at: string | null;
  publisher: { name: string } | null;
};

type ShiftRow = RosterShiftLite & {
  finish_time: string;
  position: string | null;
  note: string | null;
};

type RawShift = Omit<ShiftRow, "staff_name"> & { person: { name: string } | null };

const card = "rounded-[14px] border border-line bg-white p-4";
const pill = "inline-flex min-h-10 shrink-0 items-center rounded-full border px-3 text-sm font-semibold";

function rosterHref(siteId: string, monday: string): string {
  return `/roster?site=${siteId}&week=${monday}`;
}

// The roster (managers and the owner): pick a site and week, add, change
// and delete shifts, copy last week, publish. Warnings (leave, over 40
// hours) show inline; they never block saving.
export default async function RosterPage({ searchParams }: PageProps<"/roster">) {
  await connection();
  const supabase = await createClient();
  const { userId, me } = await getSession(supabase);
  if (!userId) redirect("/login");
  if (!me) return <NotStaff />;
  // Staff see their shifts on Time and Home. (The database refuses them anyway.)
  if (!isManager(me)) redirect("/time");

  const params = await searchParams;
  const today = aucklandDate();
  const monday = weekFromParam(typeof params.week === "string" ? params.week : undefined, today);
  const days = weekDays(monday);

  const [sitesResult, peopleResult, current] = await Promise.all([
    supabase.from("sites").select("id, name").eq("active", true).order("name"),
    // Turned-off people (leavers) can't be rostered, so they aren't offered.
    supabase.from("staff").select("id, name").eq("active", true).order("name"),
    getCurrentShift(supabase, userId),
  ]);
  const sites = (sitesResult.data ?? []) as { id: string; name: string }[];
  const people = (peopleResult.data ?? []) as { id: string; name: string }[];

  const wanted = typeof params.site === "string" ? params.site : current?.site.id;
  const site = sites.find((s) => s.id === wanted) ?? sites[0];
  if (!site) {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-6">
        <h1 className="text-3xl font-bold">Roster</h1>
        <p className="mt-4 text-muted">There are no open sites to roster.</p>
      </main>
    );
  }

  const weekResult = await supabase
    .from("roster_weeks")
    .select("id, published_at, changed_at, publisher:staff!roster_weeks_published_by_fkey(name)")
    .eq("site_id", site.id)
    .eq("week_start", monday)
    .maybeSingle();
  const week = weekResult.data as unknown as WeekRow | null;

  const [shiftsResult, warnings] = await Promise.all([
    week
      ? supabase
          .from("roster_shifts")
          .select(
            "id, staff_id, work_date, start_time, finish_time, paid_minutes, position, note, person:staff!roster_shifts_staff_id_fkey(name)",
          )
          .eq("roster_week_id", week.id)
      : Promise.resolve({ data: [], error: null }),
    loadWarnings(supabase, week?.id ?? null),
  ]);
  const error = weekResult.error ?? shiftsResult.error ?? sitesResult.error ?? peopleResult.error;
  const shifts: ShiftRow[] = ((shiftsResult.data ?? []) as unknown as RawShift[]).map(({ person, ...s }) => ({
    ...s,
    staff_name: person?.name ?? "Unknown",
  }));

  const byDay = groupByDay(shifts, monday);
  const totals = rosterTotals(shifts);
  const { byShift, week: weekWarnings } = splitWarnings(warnings);
  const state = weekState(week);
  const defaultDay = days.includes(today) ? today : monday;

  return (
    <main className="mx-auto w-full max-w-md px-4 py-6">
      <h1 className="text-3xl font-bold">Roster</h1>

      {/* Site picker */}
      <nav aria-label="Site" className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {sites.map((s) => (
          <Link
            key={s.id}
            href={rosterHref(s.id, monday)}
            aria-current={s.id === site.id ? "page" : undefined}
            className={`${pill} ${
              s.id === site.id ? "border-primary bg-primary text-white" : "border-line bg-white text-ink hover:border-muted"
            }`}
          >
            {s.name}
          </Link>
        ))}
      </nav>

      {/* Week picker */}
      <nav aria-label="Week" className="mt-3 flex items-center justify-between gap-2">
        <Link href={rosterHref(site.id, addDays(monday, -7))} className={`${pill} border-line bg-white text-ink`}>
          <span aria-hidden="true">‹</span>
          <span className="sr-only">Previous week</span>
        </Link>
        <div className="min-w-0 text-center">
          <p className="text-[15px] font-semibold text-ink">{weekRangeText(monday)}</p>
          {!days.includes(today) && (
            <Link href={rosterHref(site.id, weekFromParam(undefined, today))} className="text-sm font-semibold text-primary">
              Back to this week
            </Link>
          )}
        </div>
        <Link href={rosterHref(site.id, addDays(monday, 7))} className={`${pill} border-line bg-white text-ink`}>
          <span aria-hidden="true">›</span>
          <span className="sr-only">Next week</span>
        </Link>
      </nav>

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-red-800">
          Could not load the roster: {error.message}
        </p>
      )}

      {/* Status and publish */}
      <section className={`mt-4 ${card}`}>
        {state === "draft" && (
          <p className="text-[15px] text-ink">
            <span className="font-semibold">Not published.</span> Staff can&apos;t see this week yet.
          </p>
        )}
        {state === "published" && week?.published_at && (
          <p className="text-[15px] text-ink">
            <span className="font-semibold text-primary-dark">Published</span> {aucklandShortDay(week.published_at)},{" "}
            {aucklandTime(week.published_at)}
            {week.publisher ? ` by ${week.publisher.name}` : ""}.
          </p>
        )}
        {state === "changed" && (
          <p className="text-[15px] text-ink">
            <span className="font-semibold text-warning">Changed since published.</span> Staff already see the changes;
            re-publish to tell them.
          </p>
        )}
        {week && shifts.length > 0 && state !== "published" && (
          <ActionButton
            action={publishWeek.bind(null, { id: week.id, siteId: site.id, monday })}
            label={state === "changed" ? "Re-publish" : "Publish"}
            pendingLabel="Publishing…"
          />
        )}
        <ActionButton
          action={copyLastWeek.bind(null, site.id, monday)}
          label="Copy last week"
          pendingLabel="Copying…"
          tone="plain"
        />
      </section>

      {weekWarnings.length > 0 && (
        <section role="status" className="mt-4 rounded-[14px] bg-warning-light p-4 text-sm text-ink">
          <h2 className="font-semibold text-warning">Warnings</h2>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {weekWarnings.map((w) => (
              <li key={`${w.kind}-${w.staff_id}`}>{warningText(w)}</li>
            ))}
          </ul>
        </section>
      )}

      {/* Add a shift */}
      <details className={`mt-4 ${card}`} open={shifts.length === 0}>
        <summary className="flex min-h-12 cursor-pointer list-none items-center text-lg font-semibold">Add shift</summary>
        <div className="mt-2">
          <ShiftForm
            action={saveShift.bind(null, { kind: "add", siteId: site.id, monday })}
            idPrefix="add"
            people={people}
            days={days}
            defaults={{ staff_id: "", work_date: defaultDay, start_time: "", finish_time: "", position: "", note: "" }}
            submitLabel="Add shift"
          />
        </div>
      </details>

      {/* One section per day */}
      {byDay.map(({ date, shifts: dayShifts }) => (
        <section key={date} className="mt-5">
          <h2 className={`text-lg font-semibold ${date === today ? "text-primary-dark" : ""}`}>
            {shortYmd(date)}
            {date === today && <span className="ml-2 text-sm font-medium">Today</span>}
          </h2>
          {dayShifts.length === 0 ? (
            <p className="mt-2 rounded-xl border border-dashed border-line bg-white p-3 text-sm text-muted">Nobody rostered.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line rounded-[14px] border border-line bg-white">
              {dayShifts.map((s) => (
                <li key={s.id} className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-[15px] font-semibold text-ink">{s.staff_name}</p>
                    <p className="shrink-0 text-sm text-muted">{hoursText(s.paid_minutes)} paid</p>
                  </div>
                  <p className="text-sm text-ink">
                    {shiftTimesText(s)}
                    {s.position && <span className="text-muted"> · {s.position}</span>}
                  </p>
                  {s.note && <p className="text-sm text-muted">Note: {s.note}</p>}
                  {(byShift.get(s.id) ?? []).map((w) => (
                    <p key={w.kind} className="mt-1 rounded-lg bg-warning-light px-2 py-1 text-sm font-medium text-warning">
                      {warningText(w)}
                    </p>
                  ))}
                  <details className="mt-1">
                    <summary className="inline-flex min-h-12 cursor-pointer list-none items-center text-sm font-semibold text-primary hover:text-primary-dark">
                      Change
                    </summary>
                    <div className="mt-2 rounded-xl border border-line p-3">
                      <ShiftForm
                        action={saveShift.bind(null, { kind: "edit", id: s.id, monday })}
                        idPrefix={`edit-${s.id}`}
                        people={people.some((p) => p.id === s.staff_id) ? people : [...people, { id: s.staff_id, name: s.staff_name }]}
                        days={days}
                        defaults={{
                          staff_id: s.staff_id,
                          work_date: s.work_date,
                          start_time: hhmm(s.start_time),
                          finish_time: hhmm(s.finish_time),
                          position: s.position ?? "",
                          note: s.note ?? "",
                        }}
                        submitLabel="Save changes"
                      />
                      <ActionButton action={deleteShift.bind(null, s.id)} label="Delete shift" pendingLabel="Deleting…" tone="plain" />
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      {/* Weekly totals */}
      <section className={`mt-6 ${card}`}>
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">Totals</h2>
          <p className="text-sm text-muted">
            <span className="font-semibold text-ink">{hoursText(totals.paidMinutes)}</span> paid
          </p>
        </div>
        {totals.people.length === 0 ? (
          <p className="mt-1 text-sm text-muted">Nobody is rostered this week at {site.name}.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {totals.people.map((p) => (
              <li key={p.staffId} className="flex items-baseline justify-between gap-2 py-2 text-[15px]">
                <span className="text-ink">
                  {p.name} <span className="text-sm text-muted">· {p.shifts} {p.shifts === 1 ? "shift" : "shifts"}</span>
                </span>
                <span className="shrink-0 font-semibold text-ink">{hoursText(p.paidMinutes)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted">Paid hours at {site.name} only. Over-40 warnings count every site.</p>
      </section>
    </main>
  );
}
