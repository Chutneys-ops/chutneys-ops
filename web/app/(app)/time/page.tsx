import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { MyShiftItem } from "@/components/my-shifts";
import { NotStaff } from "@/components/not-staff";
import { hoursText } from "@/lib/breaks";
import { aucklandDate } from "@/lib/dates";
import { weekStart } from "@/lib/hours";
import { shortYmd } from "@/lib/leave";
import { addDays, compareToRoster, differenceTexts, nextShift, shiftTimesText, type RosteredForCompare } from "@/lib/roster";
import { loadMyShifts } from "@/lib/supabase/roster";
import { createClient } from "@/lib/supabase/server";
import { getCurrentShift, getSession, isManager, type Me } from "@/lib/supabase/session";
import {
  TIMESHEET_STATUS_LABELS,
  groupForApproval,
  hhmm,
  weekLabel,
  type TimesheetStatus,
} from "@/lib/timesheets";
import { approveTimesheets, deleteTimesheet, saveTimesheet } from "./actions";
import { ActionButton } from "./small-actions";
import { TimesheetForm } from "./timesheet-form";

type TimesheetRow = {
  id: string;
  staff_id: string;
  site_id: string;
  work_date: string;
  start_time: string;
  finish_time: string;
  start_at: string;
  finish_at: string;
  minutes_at_work: number;
  rest_breaks: number;
  meal_breaks: number;
  paid_minutes: number;
  status: TimesheetStatus;
  edit_note: string | null;
  person: { name: string } | null;
  site: { name: string } | null;
};

// timesheets links to staff four times (staff_id, approved_by, created_by,
// edited_by), so the join names the person's link.
const SELECT =
  "id, staff_id, site_id, work_date, start_time, finish_time, start_at, finish_at, minutes_at_work, rest_breaks, meal_breaks, " +
  "paid_minutes, status, edit_note, person:staff!timesheets_staff_id_fkey(name), site:sites(name)";

const statusClass: Record<TimesheetStatus, string> = {
  submitted: "bg-warning-light text-warning",
  approved: "bg-primary-light text-primary-dark",
};

function times(t: TimesheetRow): string {
  const nextDay = t.finish_time < t.start_time ? " (next day)" : "";
  return `${hhmm(t.start_time)}–${hhmm(t.finish_time)}${nextDay}`;
}

function breaksText(t: TimesheetRow): string {
  const rest = t.rest_breaks ? `${t.rest_breaks} x 10 min rest` : "no rest break";
  const meal = t.meal_breaks ? `${t.meal_breaks} x 30 min meal` : "no meal break";
  return `${hoursText(t.minutes_at_work)} at work · ${rest} · ${meal} · ${hoursText(t.paid_minutes)} paid`;
}

/** Rostered vs actual for one timesheet waiting for approval: the rostered
 *  shift (same person, day and site, in a published week), and differences
 *  of more than 15 minutes, or "Not rostered". */
function RosterCheck({ t, rostered }: { t: TimesheetRow; rostered: RosteredForCompare[] }) {
  const c = compareToRoster(t, rostered);
  if (c.status === "not_rostered") {
    return (
      <p className="mt-1 inline-flex rounded-full bg-warning-light px-2 py-0.5 text-xs font-semibold text-warning">
        Not rostered
      </p>
    );
  }
  const differences = differenceTexts(c);
  return (
    <p className="mt-1 text-sm text-muted">
      Rostered {shiftTimesText(c.shift)}
      {differences.length === 0 ? (
        <span className="text-primary-dark"> · matches</span>
      ) : (
        <span className="ml-1 inline-flex rounded-full bg-warning-light px-2 py-0.5 text-xs font-semibold text-warning">
          {differences.join(" · ")}
        </span>
      )}
    </p>
  );
}

/** Edit (and delete, while submitted) one timesheet, folded away. */
function EditHours({
  t,
  me,
  sites,
  today,
}: {
  t: TimesheetRow;
  me: Me;
  sites: { id: string; name: string }[];
  today: string;
}) {
  const needsNote = t.staff_id !== me.id || t.status === "approved";
  return (
    <details className="mt-2">
      <summary className="inline-flex min-h-12 cursor-pointer list-none items-center text-sm font-semibold text-primary hover:text-primary-dark">
        Change
      </summary>
      <div className="mt-2 rounded-xl border border-line p-3">
        <TimesheetForm
          action={saveTimesheet.bind(null, { kind: "edit", id: t.id, needsNote })}
          idPrefix={`edit-${t.id}`}
          sites={sites}
          today={today}
          defaults={{
            work_date: t.work_date,
            site_id: t.site_id,
            start_time: hhmm(t.start_time),
            finish_time: hhmm(t.finish_time),
          }}
          noteRequired={needsNote}
          submitLabel="Save changes"
        />
        {t.status === "submitted" && (
          <ActionButton action={deleteTimesheet.bind(null, t.id)} label="Delete these hours" pendingLabel="Deleting…" tone="plain" />
        )}
      </div>
    </details>
  );
}

// Time: today's site, your hours (with NZ breaks worked out for you) and,
// for managers and the owner, hours to approve and adding hours for someone.
export default async function TimePage() {
  await connection();
  const supabase = await createClient();
  const { userId, me } = await getSession(supabase);
  if (!userId) redirect("/login");
  if (!me) return <NotStaff />;
  const manager = isManager(me);

  const today = aucklandDate();
  const monday = weekStart(today);

  const [current, clearance, sitesResult, weekResult, pendingResult, staffResult] = await Promise.all([
    getCurrentShift(supabase, userId),
    supabase.rpc("needs_clearance"),
    supabase.from("sites").select("id, name").eq("active", true).order("name"),
    supabase
      .from("timesheets")
      .select(SELECT)
      .eq("staff_id", userId)
      .gte("work_date", monday)
      .order("work_date")
      .order("start_time"),
    manager
      ? supabase.from("timesheets").select(SELECT).eq("status", "submitted").order("work_date").limit(500)
      : Promise.resolve({ data: [], error: null }),
    manager
      ? // "Add hours for someone": turned-off people (leavers) are hidden.
      // Their past timesheets still show, through the joins.
      supabase.from("staff").select("id, name").eq("active", true).neq("id", userId).order("name")
      : Promise.resolve({ data: [], error: null }),
  ]);

  const error = weekResult.error ?? pendingResult.error ?? sitesResult.error ?? staffResult.error;
  const sites = (sitesResult.data ?? []) as { id: string; name: string }[];
  const week = (weekResult.data ?? []) as unknown as TimesheetRow[];
  const pending = (pendingResult.data ?? []) as unknown as TimesheetRow[];
  const people = (staffResult.data ?? []) as { id: string; name: string }[];
  const needsClearance = clearance.data === true;

  const weekAtWork = week.reduce((sum, t) => sum + t.minutes_at_work, 0);
  const weekPaid = week.reduce((sum, t) => sum + t.paid_minutes, 0);
  const groups = groupForApproval(pending.map((t) => ({ ...t, site_name: t.site?.name ?? "A closed site" })));

  // Your shifts this week and next (published weeks only: RLS), and for
  // managers the rostered shifts to compare with the hours waiting.
  const pendingDates = pending.map((t) => t.work_date).sort();
  const [mine, rosteredResult] = await Promise.all([
    loadMyShifts(supabase, userId, monday, addDays(monday, 13)),
    manager && pending.length > 0
      ? supabase
          .from("roster_shifts")
          .select("staff_id, site_id, work_date, start_time, finish_time, start_at, finish_at, roster_weeks!inner(published_at)")
          .not("roster_weeks.published_at", "is", null)
          .in("staff_id", [...new Set(pending.map((t) => t.staff_id))])
          .gte("work_date", pendingDates[0])
          .lte("work_date", pendingDates[pendingDates.length - 1])
          .limit(1000)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const rostered = (rosteredResult.data ?? []) as unknown as RosteredForCompare[];
  const upNext = nextShift(mine.shifts, new Date());
  // The next shift is shown up top, so the lists below leave it out.
  const others = mine.shifts.filter((s) => s.id !== upNext?.id);
  const thisWeekShifts = others.filter((s) => s.work_date < addDays(monday, 7));
  const nextWeekShifts = others.filter((s) => s.work_date >= addDays(monday, 7));

  return (
    <main className="mx-auto w-full max-w-md px-4 py-6">
      <h1 className="text-3xl font-bold">Time</h1>

      <section className="mt-4 flex items-center gap-3 rounded-[14px] border border-line bg-white p-4">
        <p className="min-w-0 flex-1 text-[15px] text-ink">
          {current ? (
            <>
              Today&apos;s site: <span className="font-semibold">{current.site.name}</span>
            </>
          ) : (
            "You haven't chosen a site today."
          )}
        </p>
        <Link
          href="/start?change=1"
          className="inline-flex min-h-12 shrink-0 items-center text-sm font-semibold text-primary hover:text-primary-dark"
        >
          {current ? "Change site" : "Choose site"}
        </Link>
      </section>

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-red-800">
          Could not load timesheets: {error.message}
        </p>
      )}

      <section className="mt-4 rounded-[14px] border border-line bg-white p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">My shifts</h2>
          {manager && (
            <Link href="/roster" className="inline-flex min-h-12 items-center text-sm font-semibold text-primary hover:text-primary-dark">
              Roster
            </Link>
          )}
        </div>
        {mine.error && (
          <p role="alert" className="mt-1 text-sm text-warning">
            Could not load your shifts: {mine.error}
          </p>
        )}
        {upNext && (
          <div className="mt-2 rounded-xl bg-primary-light p-3">
            <MyShiftItem shift={upNext} label="Next shift" />
          </div>
        )}
        {[
          { title: "This week", shifts: thisWeekShifts },
          { title: "Next week", shifts: nextWeekShifts },
        ].map((part) => (
          <div key={part.title} className="mt-3">
            <h3 className="text-sm font-semibold tracking-wide text-muted uppercase">{part.title}</h3>
            {part.shifts.length === 0 ? (
              <p className="mt-1 text-sm text-muted">{upNext ? "No other shifts." : "No shifts published yet."}</p>
            ) : (
              <ul className="mt-1 divide-y divide-line">
                {part.shifts.map((s) => (
                  <li key={s.id} className="py-2">
                    <MyShiftItem shift={s} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </section>

      <section className="mt-4 rounded-[14px] border border-line bg-white p-4">
        <h2 className="text-lg font-semibold">Add my hours</h2>
        <p className="mb-3 text-sm text-muted">Breaks are worked out for you from the NZ rules.</p>
        {needsClearance && (
          <p role="alert" className="mb-3 rounded-xl bg-warning-light p-3 text-sm text-ink">
            You reported vomiting or diarrhoea. You can&apos;t add hours for later days until a manager clears you.
          </p>
        )}
        <TimesheetForm
          action={saveTimesheet.bind(null, { kind: "mine" })}
          idPrefix="mine"
          sites={sites}
          today={today}
          defaults={{ work_date: today, site_id: current?.site.id ?? "", start_time: "", finish_time: "" }}
          submitLabel="Save my hours"
        />
      </section>

      <section className="mt-6">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">This week</h2>
          <p className="text-sm text-muted">
            <span className="font-semibold text-ink">{hoursText(weekPaid)}</span> paid ({hoursText(weekAtWork)} at work)
          </p>
        </div>
        {week.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-line bg-white p-4 text-muted">
            No hours entered since {shortYmd(monday)}.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-line rounded-[14px] border border-line bg-white">
            {week.map((t) => (
              <li key={t.id} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-[15px] font-semibold text-ink">
                    {shortYmd(t.work_date)} · {times(t)}
                  </p>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${statusClass[t.status]}`}>
                    {TIMESHEET_STATUS_LABELS[t.status]}
                  </span>
                </div>
                <p className="text-sm text-muted">{t.site?.name ?? "A closed site"}</p>
                <p className="text-sm text-muted">{breaksText(t)}</p>
                {t.edit_note && <p className="mt-1 text-sm text-ink">Note: {t.edit_note}</p>}
                {(t.status === "submitted" || manager) && <EditHours t={t} me={me} sites={sites} today={today} />}
              </li>
            ))}
          </ul>
        )}
      </section>

      {manager && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold">To approve</h2>
          {groups.length === 0 ? (
            <p className="mt-3 rounded-xl border border-dashed border-line bg-white p-4 text-muted">Nothing waiting.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {groups.map((group) => {
                // approve_timesheets skips your own unless you're the owner.
                const approvable = group.rows.filter((t) => t.staff_id !== me.id || me.role === "owner");
                const paid = group.rows.reduce((sum, t) => sum + t.paid_minutes, 0);
                return (
                  <li key={group.key} className="rounded-[14px] border border-line bg-white p-4">
                    <p className="text-[15px] font-semibold text-ink">
                      {weekLabel(group.week)} · {group.siteName}
                    </p>
                    <p className="text-sm text-muted">
                      {group.rows.length} {group.rows.length === 1 ? "timesheet" : "timesheets"} · {hoursText(paid)} paid
                    </p>
                    <ul className="mt-2 divide-y divide-line">
                      {group.rows.map((t) => (
                        <li key={t.id} className="py-2">
                          <div className="flex items-baseline justify-between gap-2">
                            <p className="text-sm font-semibold text-ink">{t.person?.name ?? "Unknown"}</p>
                            <p className="shrink-0 text-sm font-semibold text-ink">{hoursText(t.paid_minutes)} paid</p>
                          </div>
                          <p className="text-sm text-muted">
                            {shortYmd(t.work_date)} · {times(t)}
                          </p>
                          <RosterCheck t={t} rostered={rostered} />
                          {t.edit_note && <p className="text-sm text-ink">Note: {t.edit_note}</p>}
                          {t.staff_id === me.id && me.role !== "owner" && (
                            <p className="text-sm text-muted">Your own: another manager or the owner approves it.</p>
                          )}
                          <EditHours t={t} me={me} sites={sites} today={today} />
                        </li>
                      ))}
                    </ul>
                    {approvable.length > 0 && (
                      <ActionButton
                        action={approveTimesheets.bind(
                          null,
                          approvable.map((t) => t.id),
                        )}
                        label={`Approve all (${approvable.length})`}
                        pendingLabel="Approving…"
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {manager && (
        <section className="mt-6 rounded-[14px] border border-line bg-white p-4">
          <h2 className="mb-3 text-lg font-semibold">Add hours for someone</h2>
          <TimesheetForm
            action={saveTimesheet.bind(null, { kind: "someone" })}
            idPrefix="someone"
            sites={sites}
            today={today}
            defaults={{ work_date: today, site_id: current?.site.id ?? "", start_time: "", finish_time: "" }}
            people={people}
            noteRequired
            submitLabel="Save their hours"
          />
        </section>
      )}
    </main>
  );
}
