"use server";

// Settings > Notifications and Opening times. Every call runs as the
// signed-in person, so RLS keeps each person to their own subscriptions and
// switches (the database refuses anything else).

import { refresh } from "next/cache";
import { deliver, pushConfigured, type Subscription } from "@/lib/push";
import { isCategory, TEST_MESSAGE, type Category } from "@/lib/reminders";
import { createClient } from "@/lib/supabase/server";

export type Result = { ok: boolean; message?: string };

async function signedIn() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  return { supabase, userId: auth?.claims?.sub ?? null };
}

const SIGNED_OUT: Result = { ok: false, message: "You are signed out. Sign in again." };

export type BrowserSubscription = { endpoint: string; p256dh: string; auth: string };

/** Save this browser's subscription for you (it moves to you if someone
 *  else had it, e.g. a shared tablet). */
export async function saveSubscription(sub: BrowserSubscription, userAgent: string): Promise<Result> {
  const { supabase, userId } = await signedIn();
  if (!userId) return SIGNED_OUT;
  if (typeof sub?.endpoint !== "string" || !sub.endpoint.startsWith("https://") || !sub.p256dh || !sub.auth) {
    return { ok: false, message: "This browser gave an incomplete subscription. Try again." };
  }
  const { error } = await supabase.rpc("save_push_subscription", {
    endpoint: sub.endpoint,
    p256dh: sub.p256dh,
    auth_key: sub.auth,
    user_agent: String(userAgent ?? "").slice(0, 500),
  });
  if (error) return { ok: false, message: `Could not turn notifications on: ${error.message}` };
  return { ok: true, message: "Notifications are on for this device." };
}

/** Forget this browser (Turn off, and signing out). Only your own row. */
export async function removeSubscription(endpoint: string): Promise<Result> {
  const { supabase, userId } = await signedIn();
  if (!userId) return SIGNED_OUT;
  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  if (error) return { ok: false, message: `Could not turn notifications off: ${error.message}` };
  return { ok: true, message: "Notifications are off for this device." };
}

/** Is this browser's subscription saved for you (not for whoever used it before)? */
export async function isMyDevice(endpoint: string): Promise<boolean> {
  const { supabase, userId } = await signedIn();
  if (!userId) return false;
  const { data } = await supabase.from("push_subscriptions").select("id").eq("endpoint", endpoint).maybeSingle();
  return Boolean(data);
}

/** "Send me a test": to every device you've turned on, whatever your switches say. */
export async function sendTest(): Promise<Result> {
  const { supabase, userId } = await signedIn();
  if (!userId) return SIGNED_OUT;
  if (!pushConfigured()) return { ok: false, message: "Notifications aren't set up on the server yet (VAPID keys)." };
  const { data, error } = await supabase.from("push_subscriptions").select("id, staff_id, endpoint, keys, last_used_at");
  if (error) return { ok: false, message: `Could not send: ${error.message}` };
  const subs = (data ?? []) as Subscription[];
  if (subs.length === 0) return { ok: false, message: "Turn notifications on first." };
  const result = await deliver(supabase, subs, TEST_MESSAGE);
  if (result.sent > 0) {
    const devices = result.sent === 1 ? "1 device" : `${result.sent} devices`;
    return { ok: true, message: `Sent to ${devices}. It should arrive in a few seconds.` };
  }
  if (result.gone > 0) {
    return { ok: false, message: "This device's notifications were turned off in the browser. Turn them on again." };
  }
  return { ok: false, message: "The push service didn't accept it. Try again in a minute." };
}

/** One switch (notices, roster, reminders, approvals). */
export async function setPref(category: string, on: boolean): Promise<Result> {
  const { supabase, userId } = await signedIn();
  if (!userId) return SIGNED_OUT;
  if (!isCategory(category) || typeof on !== "boolean") return { ok: false, message: "Unknown setting." };
  // staff_id defaults to you; on a second save the row is updated.
  const change: Partial<Record<Category, boolean>> = { [category]: on };
  const { error } = await supabase.from("notification_prefs").upsert(change, { onConflict: "staff_id" });
  if (error) return { ok: false, message: `Could not save: ${error.message}` };
  return { ok: true };
}

/** Managers: when a site opens (for the opening checks reminder). */
export async function saveOpeningTime(siteId: string, time: string): Promise<Result> {
  const { supabase, userId } = await signedIn();
  if (!userId) return SIGNED_OUT;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { ok: false, message: "Choose a time like 09:00." };
  const { error } = await supabase.rpc("set_site_opening_time", { site: siteId, opens: time });
  if (error) {
    const readable = error.code === "42501" || error.code === "22023";
    return { ok: false, message: readable ? error.message : `Could not save: ${error.message}` };
  }
  refresh();
  return { ok: true, message: "Saved" };
}
