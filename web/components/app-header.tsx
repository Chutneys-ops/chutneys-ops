import { connection } from "next/server";
import Link from "next/link";
import { LogoMark } from "@/components/logo-mark";
import { createClient } from "@/lib/supabase/server";
import { getCurrentShift, getSession } from "@/lib/supabase/session";

function Brand() {
  return (
    <div className="mx-auto flex w-full max-w-md items-center gap-2.5 px-4 pt-2">
      <LogoMark />
      <span className="font-display text-[17px] font-semibold">Chutneys Ops</span>
    </div>
  );
}

const stripClass = "mx-auto flex w-full max-w-md items-center gap-2 px-4 py-1";
const linkClass =
  "flex min-h-12 shrink-0 items-center px-2 text-sm font-semibold text-primary underline-offset-4 hover:text-primary-dark hover:underline";

// Top of every signed-in page: the brand, then today's site with "Change
// site". The site only decides which site's records you can add; hours are
// entered as timesheets on /time.
export async function AppHeader() {
  await connection();
  const supabase = await createClient();
  const { userId } = await getSession(supabase);
  const shift = userId ? await getCurrentShift(supabase, userId) : null;

  return (
    <header className="border-b border-line bg-cream">
      <Brand />
      <div className={stripClass}>
        {shift ? (
          <>
            <p className="min-w-0 flex-1 text-sm text-muted">
              Site: <span className="font-semibold text-ink">{shift.site.name}</span>
            </p>
            <Link href="/start?change=1" className={linkClass}>
              Change site
            </Link>
          </>
        ) : (
          <>
            <p className="min-w-0 flex-1 text-sm text-muted">No site chosen today</p>
            <Link href="/start" className={linkClass}>
              Choose site
            </Link>
          </>
        )}
      </div>
    </header>
  );
}

/** Same size as the real header, shown while it loads, so nothing jumps. */
export function AppHeaderFallback() {
  return (
    <header className="border-b border-line bg-cream" aria-busy="true">
      <Brand />
      <div className={stripClass}>
        <div className="flex min-h-12 flex-1 items-center">
          <div className="h-4 w-48 animate-pulse rounded bg-line" />
        </div>
      </div>
    </header>
  );
}
