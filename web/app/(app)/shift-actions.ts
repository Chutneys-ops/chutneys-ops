"use server";

// "Choose site": which site's records you can add today. It still uses the
// start_shift database function and the shifts table, but it no longer
// means hours: hours are entered as timesheets on /time.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** Choose a site for today, then go to Records. */
export async function startShift(siteId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("start_shift", { site_id: siteId });
  // Not cleared after vomiting or diarrhoea: back to the picker, which
  // explains why, instead of the error screen.
  if (error?.hint === "needs_clearance") redirect("/start?change=1");
  if (error) throw new Error(`Could not choose that site: ${error.message}`);
  // redirect() throws, so it must come after the work and outside try/catch.
  redirect("/records");
}
