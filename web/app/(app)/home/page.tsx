import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { InstallCard } from "@/components/install-card";
import { NotStaff } from "@/components/not-staff";
import { hoursText } from "@/lib/breaks";
import { pickMessage } from "@/lib/daily-messages";
import { aucklandDate, aucklandDay } from "@/lib/dates";
import { countCards, dueToday, firstName, greeting, sumPurchases, type TemplateLite } from "@/lib/home";
import { weekStart } from "@/lib/hours";
import { LEAVE_STATUS_LABELS, dateRangeText, type LeaveStatus } from "@/lib/leave";
import { currentMonth, formatMoney, monthLabel, monthRange } from "@/lib/purchases";
import { createClient } from "@/lib/supabase/server";
import { getCurrentShift, getSession, isManager } from "@/lib/supabase/session";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const card = "mt-4 rounded-[14px] border border-line bg-white p-4";
const chevron = (
  <svg aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 6l6 6-6 6" />
  </svg>
);

/** How many rows match, without fetching them. 0 if the query fails. */
async function countOf(query: PromiseLike<{ count: number | null }>): Promise<number> {
  const { count } = await query;
  return count ?? 0;
}

/** This month's purchases (owner only), page by page past the API's 1000-row limit. */
async function purchasesThisMonth(supabase: Supabase) {
  const { start, end } = monthRange(currentMonth());
  const rows: { total_incl_gst: number | string; gst_amount: number | string }[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data } = await supabase
      .from("purchases")
      .select("total_incl_gst, gst_amount")
      .gte("purchased_at", start)
      .lt("purchased_at", end)
      .order("id")
      .range(offset, offset + 999);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return sumPurchases(rows);
  }
}

// Home: where every login lands. Greeting, the daily message, today's site
// and what's due there, your own things, and for managers and the owner
// the counts that need attention. Every query runs as you, so RLS decides
// what's counted.
export default async function HomePage() {
  await connection();
  const supabase = await createClient();
  const { userId, me } = await getSession(supabase);
  if (!userId) redirect("/login");
  if (!me) return <NotStaff />;
  const manager = isManager(me);
  const owner = me.role === "owner";

  const now = new Date();
  const today = aucklandDate(now);
  const shift = await getCurrentShift(supabase, userId);

  const [
    clearance,
    templatesResult,
    sheetsResult,
    trainingToConfirm,
    latestLeaveResult,
    weekResult,
    timesheetsToApprove,
    leaveWaiting,
    outOfRangeToday,
    notSignedOffToday,
    staffToClear,
    purchases,
  ] = await Promise.all([
    supabase.rpc("needs_clearance"),
    shift
      ? supabase
          .from("record_templates")
          .select("code, title, required_daily")
          .eq("active", true)
          .contains("site_kinds", [shift.site.kind])
          .order("sort_order")
      : Promise.resolve({ data: [] }),
    shift
      ? supabase
          .from("record_sheets")
          .select("template_code, record_entries(count)")
          .eq("site_id", shift.site.id)
          .eq("sheet_date", today)
      : Promise.resolve({ data: [] }),
    countOf(
      supabase
        .from("training_records")
        .select("id", { count: "exact", head: true })
        .eq("trainee_id", userId)
        .is("trainee_signed_at", null),
    ),
    supabase
      .from("leave_requests")
      .select("start_date, end_date, status")
      .eq("staff_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("timesheets").select("paid_minutes").eq("staff_id", userId).gte("work_date", weekStart(today)),
    manager
      ? countOf(supabase.from("timesheets").select("id", { count: "exact", head: true }).eq("status", "submitted"))
      : 0,
    manager
      ? countOf(supabase.from("leave_requests").select("id", { count: "exact", head: true }).eq("status", "pending"))
      : 0,
    manager
      ? countOf(
          supabase
            .from("record_entries")
            .select("id, record_sheets!inner(sheet_date)", { count: "exact", head: true })
            .eq("out_of_range", true)
            .eq("record_sheets.sheet_date", today),
        )
      : 0,
    manager
      ? countOf(
          supabase
            .from("record_sheets")
            .select("id", { count: "exact", head: true })
            .eq("sheet_date", today)
            .is("signed_off_at", null),
        )
      : 0,
    manager
      ? countOf(
          supabase
            .from("leave_requests")
            .select("id", { count: "exact", head: true })
            .eq("gi_symptoms", true)
            .is("cleared_to_work_at", null),
        )
      : 0,
    owner ? purchasesThisMonth(supabase) : null,
  ]);

  const needsClearance = clearance.data === true;
  const sheets = ((sheetsResult.data ?? []) as { template_code: string; record_entries: { count: number }[] }[]).map(
    (s) => ({ template_code: s.template_code, entry_count: s.record_entries[0]?.count ?? 0 }),
  );
  const due = dueToday((templatesResult.data ?? []) as TemplateLite[], sheets);
  const latestLeave = latestLeaveResult.data as { start_date: string; end_date: string; status: LeaveStatus } | null;
  const weekPaid = ((weekResult.data ?? []) as { paid_minutes: number }[]).reduce((sum, t) => sum + t.paid_minutes, 0);
  const attention = manager
    ? countCards({ timesheetsToApprove, leaveWaiting, outOfRangeToday, notSignedOffToday, staffToClear })
    : [];

  return (
    <main className="mx-auto w-full max-w-md px-4 py-6">
      <h1 className="text-3xl font-bold">
        {greeting(now)}, {firstName(me.name)}
      </h1>
      <p className="mt-1 text-sm text-muted">{aucklandDay(now)}</p>

      <InstallCard />

      <section aria-label="Today's message" className="mt-4 rounded-[14px] bg-primary px-4 py-4 text-white">
        <p className="text-[13px] font-semibold tracking-wide text-white/80 uppercase">Today</p>
        <p className="mt-1 font-display text-lg leading-snug font-semibold">{pickMessage(today)}</p>
      </section>

      {/* Today's site */}
      <section className={card}>
        {needsClearance ? (
          <div role="alert">
            <p className="font-semibold text-warning">Your manager needs to clear you to return to work after illness</p>
            <p className="mt-1 text-sm text-ink">You can&apos;t choose a site until then.</p>
            <Link href="/leave" className="mt-2 inline-flex min-h-12 items-center text-sm font-semibold text-primary hover:text-primary-dark">
              See your leave
            </Link>
          </div>
        ) : shift ? (
          <div className="flex items-center gap-3">
            <p className="min-w-0 flex-1 text-[15px] text-ink">
              Today you&apos;re at <span className="font-semibold">{shift.site.name}</span>
            </p>
            <Link
              href="/start?change=1&return=home"
              className="inline-flex min-h-12 shrink-0 items-center text-sm font-semibold text-primary hover:text-primary-dark"
            >
              Change site
            </Link>
          </div>
        ) : (
          <>
            <p className="text-[15px] text-ink">You haven&apos;t chosen a site today.</p>
            <Link
              href="/start?return=home"
              className="mt-3 flex min-h-14 w-full items-center justify-center rounded-xl bg-primary px-4 text-lg font-semibold text-white hover:bg-primary-dark"
            >
              Choose site
            </Link>
          </>
        )}
      </section>

      {/* Due today at your site */}
      {shift && (
        <section className={card}>
          <h2 className="text-lg font-semibold">Due today</h2>
          {due.length === 0 ? (
            <p className="mt-1 text-[15px] font-semibold text-primary-dark">All done for today</p>
          ) : (
            <ul className="mt-2 divide-y divide-line">
              {due.map((t) => (
                <li key={t.code}>
                  <Link href={`/records/${t.code}`} className="flex min-h-12 items-center gap-3 py-2 hover:text-primary-dark">
                    <span className="min-w-0 flex-1 text-[15px] text-ink">{t.title}</span>
                    {chevron}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Managers and owner: what needs attention (zero cards are hidden) */}
      {attention.length > 0 && (
        <section className={card}>
          <h2 className="text-lg font-semibold">Needs attention</h2>
          <ul className="mt-2 divide-y divide-line">
            {attention.map((c) => (
              <li key={c.key}>
                <Link href={c.href} className="flex min-h-12 items-center gap-3 py-2 hover:text-primary-dark">
                  <span className={`min-w-0 flex-1 text-[15px] ${c.urgent ? "font-semibold text-warning" : "text-ink"}`}>
                    {c.text}
                  </span>
                  {chevron}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Your stuff */}
      <section className={card}>
        <h2 className="text-lg font-semibold">Your stuff</h2>
        <ul className="mt-2 divide-y divide-line">
          {trainingToConfirm > 0 && (
            <li>
              <Link href="/training" className="flex min-h-12 items-center gap-3 py-2 text-ink">
                <span className="min-w-0 flex-1 text-[15px] font-semibold text-warning">
                  {trainingToConfirm} training {trainingToConfirm === 1 ? "record" : "records"} to confirm
                </span>
                {chevron}
              </Link>
            </li>
          )}
          <li>
            <Link href="/time" className="flex min-h-12 items-center gap-3 py-2 text-ink">
              <span className="min-w-0 flex-1 text-[15px] text-ink">
                This week: <span className="font-semibold">{hoursText(weekPaid)}</span> paid
              </span>
              {chevron}
            </Link>
          </li>
          <li>
            <Link href="/leave" className="flex min-h-12 items-center gap-3 py-2 text-ink">
              <span className="min-w-0 flex-1 text-[15px] text-ink">
                {latestLeave
                  ? `Leave ${dateRangeText(latestLeave.start_date, latestLeave.end_date)}: ${LEAVE_STATUS_LABELS[latestLeave.status]}`
                  : "No leave requests"}
              </span>
              {chevron}
            </Link>
          </li>
        </ul>
      </section>

      {/* Owner: purchases this month */}
      {owner && purchases && (
        <section className={card}>
          <Link href="/purchases" className="flex min-h-12 items-center gap-3 text-ink">
            <span className="min-w-0 flex-1">
              <span className="block text-lg font-semibold text-ink">Purchases, {monthLabel(currentMonth())}</span>
              <span className="block text-sm text-muted">
                {purchases.count} {purchases.count === 1 ? "purchase" : "purchases"} ·{" "}
                <span className="font-semibold text-ink">{formatMoney(purchases.totalCents)}</span> · GST{" "}
                {formatMoney(purchases.gstCents)}
              </span>
            </span>
            {chevron}
          </Link>
        </section>
      )}
    </main>
  );
}
