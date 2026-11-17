"use server";

// Server actions for the opening checklist.
//
// Never trust the arguments: anyone can call a server action with any
// siteId or itemId. The real guard is RLS in the database (see the
// opening_checklist migration). These functions just give friendly errors.

import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { aucklandDate } from "@/lib/dates";

const CHECKLIST = "opening";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Run = { id: string; submitted_at: string | null };

async function requireUserId(supabase: Supabase): Promise<string> {
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) throw new Error("You are signed out. Sign in again.");
  return userId;
}

async function findTodayRun(supabase: Supabase, siteId: string): Promise<Run | null> {
  const { data, error } = await supabase
    .from("checklist_runs")
    .select("id, submitted_at")
    .eq("site_id", siteId)
    .eq("checklist", CHECKLIST)
    .eq("run_date", aucklandDate())
    .maybeSingle();
  if (error) throw new Error(`Could not load today's checklist: ${error.message}`);
  return data;
}

/** Today's run for the site, created on the first tick. */
async function getOrCreateTodayRun(supabase: Supabase, siteId: string): Promise<Run> {
  const existing = await findTodayRun(supabase, siteId);
  if (existing) return existing;

  // run_date comes from the database default today_nz().
  // ignoreDuplicates = "on conflict do nothing", in case two phones tick
  // the first item at the same moment.
  const { error } = await supabase
    .from("checklist_runs")
    .upsert(
      { site_id: siteId, checklist: CHECKLIST },
      { onConflict: "site_id,checklist,run_date", ignoreDuplicates: true },
    );
  if (error) throw new Error(`Could not start today's checklist: ${error.message}`);

  const run = await findTodayRun(supabase, siteId);
  if (!run) throw new Error("Could not start today's checklist. Try again.");
  return run;
}

export async function tickItem(siteId: string, itemId: string) {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);
  const run = await getOrCreateTodayRun(supabase, siteId);
  if (run.submitted_at) throw new Error("This checklist is already submitted.");

  // ticked_at comes from the database (now()), not from here.
  const { error } = await supabase
    .from("checklist_ticks")
    .insert({ run_id: run.id, item_id: itemId, ticked_by: userId });

  // 23505 = unique violation: it was already ticked (double tap). That's fine.
  if (error && error.code !== "23505") {
    throw new Error(`Could not tick that item: ${error.message}`);
  }
  refresh();
}

export async function untickItem(siteId: string, itemId: string) {
  const supabase = await createClient();
  await requireUserId(supabase);
  const run = await findTodayRun(supabase, siteId);
  if (!run) return; // Nothing ticked today, so nothing to untick.
  if (run.submitted_at) throw new Error("This checklist is already submitted.");

  const { error } = await supabase
    .from("checklist_ticks")
    .delete()
    .eq("run_id", run.id)
    .eq("item_id", itemId);
  if (error) throw new Error(`Could not untick that item: ${error.message}`);
  refresh();
}

export async function submitChecklist(siteId: string) {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);
  const run = await findTodayRun(supabase, siteId);
  if (!run) throw new Error("Tick every item before submitting.");
  if (run.submitted_at) return; // Already submitted, e.g. a double tap.

  // Setting submitted_by fires the database trigger, which checks every
  // item is ticked and stamps submitted_at.
  const { data, error } = await supabase
    .from("checklist_runs")
    .update({ submitted_by: userId })
    .eq("id", run.id)
    .is("submitted_at", null)
    .select("id");

  // 23514 = check_violation, raised by the trigger when items are missing.
  if (error?.code === "23514") throw new Error("Tick every item before submitting.");
  if (error) throw new Error(`Could not submit: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error("Could not submit. It may already be submitted, or you can't edit this site.");
  }
  refresh();
}
