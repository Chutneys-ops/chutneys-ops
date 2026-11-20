// Phone notifications for things that just happened. Each hook is called by
// a server action AFTER its database change succeeded under the person's
// own session, so a failed save never notifies anyone, and only people the
// database allowed to post / publish / decide can trigger one.
//
// Who gets them, and the wording, are in lib/reminders.ts (tested). The
// sending is lib/push.ts. None of these ever throw: a failed push must never
// fail the post, publish or decision.
//
// Scheduled reminders (fridge, opening checks, the 17:00 digest, shift
// tomorrow) are in app/api/cron/reminders/route.ts.

import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { audienceFor, RECENT_SITE_DAYS } from "@/lib/notices";
import { sendToPeople } from "@/lib/push";
import { leaveDecidedMessage, noticeMessage, rosterMessage } from "@/lib/reminders";
import { payslipMessage } from "@/lib/payslips";

function logFailure(what: string, error: unknown) {
  console.error(`Could not send ${what} notifications:`, (error as Error)?.message ?? error);
}

export type NewNoticeAlert = {
  id: string;
  title: string;
  /** null = everyone; otherwise people who chose these sites recently
   *  (audienceFor in lib/notices.ts has the rule). */
  siteIds: string[] | null;
  needsAck: boolean;
  postedBy: string;
};

/** "New notice: <title>" to the notice's audience, opening /notices/<id>.
 *  Editing a notice doesn't notify. */
export async function notifyNewNotice(notice: NewNoticeAlert): Promise<void> {
  try {
    const admin = createAdminClient();
    const since = new Date(Date.now() - RECENT_SITE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const [{ data: people }, { data: choices }] = await Promise.all([
      admin.from("staff").select("id, name, active"),
      notice.siteIds
        ? admin.from("shifts").select("staff_id, site_id, clock_in").in("site_id", notice.siteIds).gt("clock_in", since)
        : Promise.resolve({ data: [] }),
    ]);
    const audience = audienceFor(
      { site_ids: notice.siteIds, posted_by: notice.postedBy },
      (people ?? []) as { id: string; name: string; active: boolean }[],
      (choices ?? []) as { staff_id: string; site_id: string; clock_in: string }[],
    );
    await sendToPeople(
      audience.map((p) => p.id),
      "notices",
      noticeMessage(notice),
    );
  } catch (error) {
    logFailure("notice", error);
  }
}

export type RosterPublishedAlert = {
  weekId: string;
  siteId: string;
  /** The Monday, "YYYY-MM-DD". */
  weekStart: string;
  /** Everyone rostered that week at that site. */
  staffIds: string[];
  /** false: first publish ("Your shifts ... are up").
   *  true: a published week changed and was published again ("Your shifts changed"). */
  republished: boolean;
};

/** Tell the people on a week's roster that it's up, or that it changed. */
export async function notifyRosterPublished(alert: RosterPublishedAlert): Promise<void> {
  if (alert.staffIds.length === 0) return;
  try {
    const admin = createAdminClient();
    const { data: site } = await admin.from("sites").select("name").eq("id", alert.siteId).maybeSingle();
    await sendToPeople(
      alert.staffIds,
      "roster",
      rosterMessage({ weekStart: alert.weekStart, siteName: (site?.name as string) ?? "your site", republished: alert.republished }),
    );
  } catch (error) {
    logFailure("roster", error);
  }
}

/** "Your sick leave for Fri 20 Nov was approved" to the person who asked.
 *  Not when the owner decides their own. */
export async function notifyLeaveDecided(requestId: string, decidedBy: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("leave_requests")
      .select("id, staff_id, status, start_date, end_date")
      .eq("id", requestId)
      .maybeSingle();
    if (!data || data.status === "pending" || data.staff_id === decidedBy) return;
    await sendToPeople(
      [data.staff_id as string],
      "approvals",
      leaveDecidedMessage(data as { id: string; status: "approved" | "declined"; start_date: string; end_date: string }),
    );
  } catch (error) {
    logFailure("leave", error);
  }
}

export type PublishedPayslip = { id: string; staff_id: string; period_start: string; period_end: string };

/** "Your payslip for 10 to 16 Nov is ready" to each person whose payslip
 *  was just published (publish_payslips returned it, so the caller is the
 *  owner). One message per payslip. */
export async function notifyPayslipsPublished(payslips: PublishedPayslip[]): Promise<void> {
  for (const payslip of payslips) {
    try {
      await sendToPeople([payslip.staff_id], "payslips", payslipMessage(payslip));
    } catch (error) {
      logFailure("payslip", error);
    }
  }
}
