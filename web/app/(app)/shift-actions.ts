"use server";

// Clocking in, changing site and clocking out. The database functions stamp
// the times with now(); the browser never sends a time.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** Pick a site = clock in there (and out of anywhere else), then go to Records. */
export async function startShift(siteId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("start_shift", { site_id: siteId });
  if (error) throw new Error(`Could not clock in: ${error.message}`);
  // redirect() throws, so it must come after the work and outside try/catch.
  redirect("/records");
}

export async function clockOut() {
  const supabase = await createClient();
  const { error } = await supabase.rpc("clock_out");
  if (error) throw new Error(`Could not clock out: ${error.message}`);
  redirect("/start");
}
