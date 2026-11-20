// POST /api/cron/reminders: the scheduled reminders check.
//
// Supabase pg_cron calls this every 5 minutes (run_reminders() in the
// notifications migration) with "Authorization: Bearer <CRON_SECRET>".
// Anything without the right secret gets 401, before any work is done.
//
// Each run:
//   1. gathers today's data with the admin client (there's no signed-in
//      person; the secret is the check);
//   2. asks lib/reminders.ts what's due now (tested there);
//   3. claims each reminder's key in sent_notifications (unique), so a
//      reminder already sent, or being sent by an overlapping run, is skipped;
//   4. sends the new ones. If every push to a person failed for a passing
//      reason (not "gone"), the claim is removed so the next run tries again.

import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { aucklandDate } from "@/lib/dates";
import { deliver, loadSubscriptions, pushConfigured, type Subscription } from "@/lib/push";
import {
  dueReminders,
  prefsFrom,
  tomorrowYmd,
  type ChoiceLite,
  type PersonLite,
  type Prefs,
  type ReminderData,
  type SiteLite,
  type TomorrowShift,
} from "@/lib/reminders";
import { STALE_HOURS } from "@/lib/hours";
import { createAdminClient } from "@/lib/supabase/admin";

/** Constant-time compare (hashing first makes the lengths equal). */
function secretMatches(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function authorised(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected || expected.length < 32) return false; // not set up: refuse everything
  const header = request.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  return given.length > 0 && secretMatches(given, expected);
}

/** For local testing only: {"now": "2026-11-20T10:05:00+13:00"} pretends
 *  it's that time. Ignored in production. */
async function clock(request: NextRequest): Promise<Date> {
  if (process.env.NODE_ENV === "production") return new Date();
  try {
    const body = (await request.json()) as { now?: string };
    const when = body?.now ? new Date(body.now) : null;
    return when && !Number.isNaN(when.getTime()) ? when : new Date();
  } catch {
    return new Date();
  }
}

type Admin = ReturnType<typeof createAdminClient>;

async function gather(admin: Admin, now: Date): Promise<ReminderData> {
  const today = aucklandDate(now);
  const staleBefore = new Date(now.getTime() - STALE_HOURS * 60 * 60 * 1000).toISOString();
  const [sites, templates, sheets, choices, people, prefs, subs, timesheets, leave, tomorrow] = await Promise.all([
    admin.from("sites").select("id, name, kind, opens_at").eq("active", true),
    admin.from("record_templates").select("code, site_kinds").eq("active", true),
    admin.from("record_sheets").select("site_id, template_code, record_entries(count)").eq("sheet_date", today),
    admin.from("shifts").select("staff_id, site_id, clock_in").is("clock_out", null).gt("clock_in", staleBefore),
    admin.from("staff").select("id, name, role, active"),
    admin.from("notification_prefs").select("staff_id, notices, roster, reminders, approvals"),
    admin.from("push_subscriptions").select("staff_id"),
    admin.from("timesheets").select("staff_id").eq("status", "submitted"),
    admin.from("leave_requests").select("staff_id").eq("status", "pending"),
    admin
      .from("roster_shifts")
      .select("staff_id, site_id, start_time, finish_time, roster_weeks!inner(published_at)")
      .eq("work_date", tomorrowYmd(now))
      .not("roster_weeks.published_at", "is", null),
  ]);
  const failed = [sites, templates, sheets, choices, people, prefs, subs, timesheets, leave, tomorrow].find((r) => r.error);
  if (failed?.error) throw new Error(failed.error.message);

  const prefMap: Record<string, Prefs> = {};
  for (const row of prefs.data ?? []) prefMap[row.staff_id as string] = prefsFrom(row);

  return {
    sites: (sites.data ?? []) as SiteLite[],
    templates: (templates.data ?? []) as { code: string; site_kinds: string[] }[],
    doneToday: ((sheets.data ?? []) as { site_id: string; template_code: string; record_entries: { count: number }[] }[])
      .filter((s) => (s.record_entries?.[0]?.count ?? 0) > 0)
      .map((s) => ({ site_id: s.site_id, template_code: s.template_code })),
    choices: (choices.data ?? []) as ChoiceLite[],
    people: (people.data ?? []) as PersonLite[],
    prefs: prefMap,
    subscribed: [...new Set((subs.data ?? []).map((s) => s.staff_id as string))],
    timesheetsWaiting: (timesheets.data ?? []) as { staff_id: string }[],
    leaveWaiting: (leave.data ?? []) as { staff_id: string }[],
    tomorrowShifts: (tomorrow.data ?? []) as unknown as TomorrowShift[],
  };
}

export async function POST(request: NextRequest) {
  if (!authorised(request)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  if (!pushConfigured()) {
    return NextResponse.json({ error: "Push is not set up (VAPID keys missing)" }, { status: 503 });
  }

  const now = await clock(request);
  try {
    const admin = createAdminClient();
    const due = dueReminders(now, await gather(admin, now));
    if (due.length === 0) return NextResponse.json({ at: now.toISOString(), due: 0, sent: 0 });

    // Claim: only rows actually inserted come back (ON CONFLICT DO NOTHING).
    const { data: claimed, error: claimError } = await admin
      .from("sent_notifications")
      .upsert(
        due.map((r) => ({ staff_id: r.staffId, kind: r.kind, for_date: r.forDate, dedupe_key: r.key })),
        { onConflict: "dedupe_key", ignoreDuplicates: true },
      )
      .select("dedupe_key");
    if (claimError) throw new Error(claimError.message);
    const newKeys = new Set((claimed ?? []).map((c) => c.dedupe_key as string));
    const toSend = due.filter((r) => newKeys.has(r.key));

    const subs = await loadSubscriptions(admin, [...new Set(toSend.map((r) => r.staffId))]);
    const byPerson = new Map<string, Subscription[]>();
    for (const s of subs) byPerson.set(s.staff_id, [...(byPerson.get(s.staff_id) ?? []), s]);

    let sent = 0;
    const retry: string[] = [];
    for (const r of toSend) {
      const result = await deliver(admin, byPerson.get(r.staffId) ?? [], {
        title: r.title,
        body: r.body,
        url: r.url,
        tag: r.kind,
      });
      if (result.sent > 0) sent += 1;
      else if (result.failed > 0) retry.push(r.key);
    }
    if (retry.length > 0) await admin.from("sent_notifications").delete().in("dedupe_key", retry);

    return NextResponse.json({
      at: now.toISOString(),
      due: due.length,
      alreadySent: due.length - toSend.length,
      sent,
      retryNextRun: retry.length,
    });
  } catch (error) {
    console.error("Reminders run failed:", (error as Error).message);
    return NextResponse.json({ error: "Reminders run failed" }, { status: 500 });
  }
}
