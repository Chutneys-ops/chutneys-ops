import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { ForgottenShiftNotice } from "@/components/forgotten-shift-notice";
import { NotStaff } from "@/components/not-staff";
import { aucklandDate, aucklandShortDay, aucklandTime } from "@/lib/dates";
import {
  STALE_HOURS,
  crossesMidnight,
  formatDuration,
  isStaleOpen,
  shiftMinutes,
  shiftsThisWeek,
  toAucklandLocalInput,
  totalMinutes,
} from "@/lib/hours";
import { createClient } from "@/lib/supabase/server";
import { getCurrentShift, getForgottenShift, getSession, isManager } from "@/lib/supabase/session";
import { clockOut } from "../shift-actions";
import { fixClockOut } from "./actions";
import { FixShiftForm } from "./fix-shift-form";

type ShiftRow = {
  id: string;
  clock_in: string;
  clock_out: string | null;
  needs_review: boolean;
  edit_note: string | null;
  site: { name: string } | null;
};

type ToFix = {
  id: string;
  clock_in: string;
  clock_out: string | null;
  person: { name: string } | null;
  site: { name: string } | null;
};

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Managers and owner: shifts closed with zero hours (needs_review) or still
 *  open after 14 hours, each with a form to set the real clock-out. */
async function NeedsFixing({ now }: { now: Date }) {
  const supabase = await createClient();
  const cutoff = new Date(now.getTime() - STALE_HOURS * HOUR).toISOString();
  // "person:staff!staff_id(name)": shifts has two links to staff (staff_id
  // and edited_by), so the !staff_id hint says which one to follow.
  const { data, error } = await supabase
    .from("shifts")
    .select("id, clock_in, clock_out, person:staff!staff_id(name), site:sites(name)")
    .or(`needs_review.eq.true,and(clock_out.is.null,clock_in.lt."${cutoff}")`)
    .order("clock_in");
  const shifts = (data ?? []) as unknown as ToFix[];

  if (error) {
    return (
      <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-red-800">
        Could not load shifts to fix: {error.message}
      </p>
    );
  }
  if (shifts.length === 0) return null;

  const max = toAucklandLocalInput(now);
  return (
    <section className="mt-4 rounded-[14px] border border-warning/40 bg-warning-light p-4">
      <h2 className="text-lg font-semibold text-warning">
        <span aria-hidden="true">⚠ </span>Needs fixing ({shifts.length})
      </h2>
      <p className="mt-1 text-sm text-ink">
        Nobody clocked out of these shifts. They count zero hours until you set the real time.
      </p>
      <ul className="mt-3 space-y-3">
        {shifts.map((shift) => {
          // Default: clock-in + 8 hours, but never in the future.
          const guess = new Date(Math.min(new Date(shift.clock_in).getTime() + 8 * HOUR, now.getTime()));
          return (
            <li key={shift.id} className="rounded-xl border border-line bg-white p-3.5">
              <p className="text-[15px] font-semibold text-ink">{shift.person?.name ?? "Unknown"}</p>
              <p className="text-sm text-muted">
                {shift.site?.name ?? "A closed site"} · clocked in {aucklandShortDay(shift.clock_in)},{" "}
                {aucklandTime(shift.clock_in)}
                {shift.clock_out ? "" : " · still open"}
              </p>
              <FixShiftForm
                action={fixClockOut.bind(null, shift.id)}
                shiftId={shift.id}
                defaultClockOut={toAucklandLocalInput(guess)}
                min={toAucklandLocalInput(shift.clock_in)}
                max={max}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default async function TimePage() {
  await connection();
  const supabase = await createClient();
  const { userId, me } = await getSession(supabase);
  if (!userId) redirect("/login");
  if (!me) return <NotStaff />;

  // Your own shifts from the last 8 days (RLS: staff see only their own).
  // shiftsThisWeek then keeps the ones that started since Monday, Auckland time.
  const now = new Date();
  const [current, forgotten, shiftsResult] = await Promise.all([
    getCurrentShift(supabase, userId),
    getForgottenShift(supabase, userId),
    supabase
      .from("shifts")
      .select("id, clock_in, clock_out, needs_review, edit_note, site:sites(name)")
      .eq("staff_id", userId)
      .gte("clock_in", new Date(now.getTime() - 8 * DAY).toISOString())
      .order("clock_in", { ascending: false }),
  ]);

  const week = shiftsThisWeek((shiftsResult.data ?? []) as unknown as ShiftRow[], aucklandDate(now));
  const total = totalMinutes(week, now);

  return (
    <main className="mx-auto w-full max-w-md px-4 py-6">
      <h1 className="text-3xl font-bold">Time</h1>

      {/* Staff never see this: it's only rendered for managers and the owner
          (and RLS would only show staff their own shifts anyway). */}
      {isManager(me) && <NeedsFixing now={now} />}

      {forgotten && <ForgottenShiftNotice siteName={forgotten.siteName} clockIn={forgotten.clock_in} />}

      <section className="mt-4 rounded-[14px] border border-line bg-white p-4">
        {current ? (
          <>
            <p className="text-[15px] text-ink">
              On shift at <span className="font-semibold">{current.site.name}</span> since{" "}
              {aucklandTime(current.clock_in)}
            </p>
            <p className="mt-0.5 text-sm text-muted">
              {formatDuration(shiftMinutes({ clock_in: current.clock_in, clock_out: null }, now))} so far
            </p>
            <form action={clockOut} className="mt-3">
              <button
                type="submit"
                className="min-h-12 w-full rounded-xl border border-line bg-white px-4 font-semibold text-ink hover:border-muted"
              >
                Clock out
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="text-[15px] text-ink">You&apos;re not clocked in.</p>
            <Link
              href="/start"
              className="mt-3 flex min-h-12 w-full items-center justify-center rounded-xl bg-primary px-4 font-semibold text-white hover:bg-primary-dark"
            >
              Pick a site to start
            </Link>
          </>
        )}
      </section>

      <section className="mt-6">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">This week</h2>
          <p className="text-sm text-muted">
            Total <span className="font-semibold text-ink">{formatDuration(total)}</span>
          </p>
        </div>

        {shiftsResult.error && (
          <p role="alert" className="mt-3 rounded-xl bg-red-50 p-4 text-red-800">
            Could not load shifts: {shiftsResult.error.message}
          </p>
        )}

        {week.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-line bg-white p-4 text-muted">
            No shifts yet this week.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-line rounded-[14px] border border-line bg-white">
            {week.map((shift) => {
              const missing = shift.needs_review || isStaleOpen(shift, now);
              return (
                <li key={shift.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-semibold text-ink">
                      {aucklandShortDay(shift.clock_in)} · {shift.site?.name ?? "A closed site"}
                    </p>
                    <p className="text-sm text-muted">
                      {aucklandTime(shift.clock_in)} –{" "}
                      {missing ? "?" : shift.clock_out ? aucklandTime(shift.clock_out) : "now"}
                      {!missing && crossesMidnight(shift) && " (next day)"}
                    </p>
                    {missing && (
                      <p className="mt-0.5 text-sm font-medium text-warning">
                        Clock-out missing: your manager will fix it
                      </p>
                    )}
                    {!missing && shift.edit_note && (
                      <p className="mt-0.5 text-sm text-muted">Clock-out fixed by a manager: {shift.edit_note}</p>
                    )}
                  </div>
                  <p className="shrink-0 text-sm font-semibold text-ink">{formatDuration(shiftMinutes(shift, now))}</p>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
