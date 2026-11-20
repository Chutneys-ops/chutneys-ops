// Sending phone notifications (Web Push) with the web-push library.
//
// server-only: the VAPID private key (VAPID_PRIVATE_KEY, no NEXT_PUBLIC_)
// signs every message, so this file must never reach a browser. The build
// fails if browser code imports it.
//
// Who may call it:
//   - lib/notify.ts, from server actions, only AFTER the action's own
//     database call succeeded under the person's session (a notice saved, a
//     roster published, leave decided). That success proves they're allowed.
//   - the reminders route, after it checked CRON_SECRET.
//   - Settings > "Send me a test", with the person's own session (their own
//     subscriptions only).

import "server-only";

import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { isGoneStatus, prefsFrom, safeUrl, type Category, type PushMessage } from "@/lib/reminders";

export type Subscription = {
  id: string;
  staff_id: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  last_used_at: string | null;
};

const SUBSCRIPTION_COLUMNS = "id, staff_id, endpoint, keys, last_used_at";

let configured: boolean | null = null;

/** Push is set up when all three VAPID values are in the environment. */
export function pushConfigured(): boolean {
  if (configured !== null) return configured;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    console.warn("Push is off: set NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT (README > Notifications).");
    configured = false;
    return false;
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export type DeliveryResult = { sent: number; gone: number; failed: number };

/** Send one message to these subscriptions. Gone ones (404/410) are
 *  deleted with the client given (the person's own, or the admin client).
 *  Never throws: a failed push must never fail the action that caused it. */
export async function deliver(
  supabase: SupabaseClient,
  subs: Subscription[],
  message: PushMessage,
): Promise<DeliveryResult> {
  const result: DeliveryResult = { sent: 0, gone: 0, failed: 0 };
  if (subs.length === 0 || !pushConfigured()) return result;

  const payload = JSON.stringify({ ...message, url: safeUrl(message.url) });
  const goneIds: string[] = [];
  const usedIds: string[] = [];
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload, {
          TTL: 12 * 60 * 60, // undelivered after 12 hours (phone off): drop it
          urgency: "normal",
          topic: message.tag?.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || undefined,
        });
        result.sent += 1;
        if (!sub.last_used_at || new Date(sub.last_used_at).getTime() < dayAgo) usedIds.push(sub.id);
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (isGoneStatus(status)) {
          result.gone += 1;
          goneIds.push(sub.id);
        } else {
          result.failed += 1;
          console.error(`Push failed (${status ?? "no status"}):`, (error as Error).message);
        }
      }
    }),
  );

  try {
    if (goneIds.length > 0) await supabase.from("push_subscriptions").delete().in("id", goneIds);
    // last_used_at needs the admin client (no update grant); for the
    // person's own client this quietly does nothing.
    if (usedIds.length > 0) {
      await supabase.from("push_subscriptions").update({ last_used_at: new Date().toISOString() }).in("id", usedIds);
    }
  } catch (error) {
    console.error("Could not tidy push subscriptions:", (error as Error).message);
  }
  return result;
}

/** Every subscription of these people (admin client). */
export async function loadSubscriptions(admin: SupabaseClient, staffIds: string[]): Promise<Subscription[]> {
  if (staffIds.length === 0) return [];
  const { data, error } = await admin.from("push_subscriptions").select(SUBSCRIPTION_COLUMNS).in("staff_id", staffIds);
  if (error) throw new Error(`Could not read push subscriptions: ${error.message}`);
  return (data ?? []) as Subscription[];
}

/** Send to people who are active, have this switch on and have turned
 *  notifications on somewhere. Used by lib/notify.ts. Never throws. */
export async function sendToPeople(staffIds: string[], category: Category, message: PushMessage): Promise<DeliveryResult> {
  const empty = { sent: 0, gone: 0, failed: 0 };
  const ids = [...new Set(staffIds)];
  if (ids.length === 0 || !pushConfigured()) return empty;
  try {
    const admin = createAdminClient();
    const [{ data: people }, { data: prefRows }] = await Promise.all([
      admin.from("staff").select("id, active").in("id", ids),
      admin.from("notification_prefs").select("staff_id, notices, roster, reminders, approvals, payslips").in("staff_id", ids),
    ]);
    const prefs = new Map((prefRows ?? []).map((r) => [r.staff_id as string, prefsFrom(r)]));
    const wanted = (people ?? [])
      .filter((p) => p.active && (prefs.get(p.id as string) ?? prefsFrom(null))[category])
      .map((p) => p.id as string);
    const subs = await loadSubscriptions(admin, wanted);
    return await deliver(admin, subs, message);
  } catch (error) {
    console.error("Notification not sent:", (error as Error).message);
    return empty;
  }
}
