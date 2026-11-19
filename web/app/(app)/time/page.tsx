import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { NotStaff } from "@/components/not-staff";
import { aucklandDate, aucklandShortDay, aucklandTime } from "@/lib/dates";
import { crossesMidnight, formatDuration, shiftMinutes, shiftsThisWeek, totalMinutes } from "@/lib/hours";
import { createClient } from "@/lib/supabase/server";
import { getCurrentShift, getSession } from "@/lib/supabase/session";
import { clockOut } from "../shift-actions";

type ShiftRow = {
  id: string;
  clock_in: string;
  clock_out: string | null;
  edit_note: string | null;
  site: { name: string } | null;
};

const DAY = 24 * 60 * 60 * 1000;

export default async function TimePage() {
  await connection();
  const supabase = await createClient();
  const { userId, me } = await getSession(supabase);
  if (!userId) redirect("/login");
  if (!me) return <NotStaff />;

  // Your own shifts from the last 8 days (RLS: staff see only their own).
  // shiftsThisWeek then keeps the ones that started since Monday, Auckland time.
  const now = new Date();
  const [current, shiftsResult] = await Promise.all([
    getCurrentShift(supabase, userId),
    supabase
      .from("shifts")
      .select("id, clock_in, clock_out, edit_note, site:sites(name)")
      .eq("staff_id", userId)
      .gte("clock_in", new Date(now.getTime() - 8 * DAY).toISOString())
      .order("clock_in", { ascending: false }),
  ]);

  const week = shiftsThisWeek((shiftsResult.data ?? []) as unknown as ShiftRow[], aucklandDate(now));
  const total = totalMinutes(week, now);

  return (
    <main className="mx-auto w-full max-w-md px-4 py-6">
      <h1 className="text-3xl font-bold">Time</h1>

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
            {week.map((shift) => (
              <li key={shift.id} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold text-ink">
                    {aucklandShortDay(shift.clock_in)} · {shift.site?.name ?? "A closed site"}
                  </p>
                  <p className="text-sm text-muted">
                    {aucklandTime(shift.clock_in)} –{" "}
                    {shift.clock_out ? aucklandTime(shift.clock_out) : "now"}
                    {crossesMidnight(shift) && " (next day)"}
                  </p>
                  {shift.edit_note && (
                    <p className="mt-0.5 text-sm text-muted">Clock-out fixed by a manager: {shift.edit_note}</p>
                  )}
                </div>
                <p className="shrink-0 text-sm font-semibold text-ink">{formatDuration(shiftMinutes(shift, now))}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
