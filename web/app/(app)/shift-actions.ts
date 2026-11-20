"use server";

// "Choose site": which site's records you can add today. It still uses the
// start_shift database function and the shifts table, but it no longer
// means hours: hours are entered as timesheets on /time.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Where to go after choosing. Only these, so a crafted form can't send
// people somewhere else.
const RETURN_TO = new Set(["/home", "/records"]);

/** Choose a site for today, then go back to Home or on to Records. */
export async function startShift(siteId: string, returnTo: string = "/records") {
  const supabase = await createClient();
  const { error } = await supabase.rpc("start_shift", { site_id: siteId });
  // Not cleared after vomiting or diarrhoea: back to the picker, which
  // explains why, instead of the error screen.
  if (error?.hint === "needs_clearance") redirect(returnTo === "/home" ? "/start?change=1&return=home" : "/start?change=1");
  if (error) throw new Error(`Could not choose that site: ${error.message}`);
  // redirect() throws, so it must come after the work and outside try/catch.
  redirect(RETURN_TO.has(returnTo) ? returnTo : "/records");
}
