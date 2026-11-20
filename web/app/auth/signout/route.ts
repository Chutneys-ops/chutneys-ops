import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { readSession } from "@/lib/supabase/session";

// getSession() sends a turned-off person here. A route handler (unlike a
// page) can write cookies, so this is where their sign-in cookies are
// cleared. Then the login page says why.
//
// It only signs out people whose account really is off, so a link to this
// page can't be used to sign anyone else out.
export async function GET() {
  const supabase = await createClient();
  const { userId, me } = await readSession(supabase);

  if (me?.active) redirect("/home");

  // scope "local": just this browser. Their other sessions were already
  // deleted by set_staff_active.
  if (userId) await supabase.auth.signOut({ scope: "local" });
  redirect(me ? "/login?notice=deactivated" : "/login");
}
