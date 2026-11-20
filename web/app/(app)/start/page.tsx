import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { NotStaff } from "@/components/not-staff";
import { createClient } from "@/lib/supabase/server";
import { getCurrentShift, getSession, isManager, kindLabel } from "@/lib/supabase/session";
import { startShift } from "../shift-actions";

// "Choose site": which site's records you can add today. It doesn't record
// hours (those are timesheets on /time). Already chosen today? You go
// straight to Records, unless you came here with ?change=1 ("Change site").
export default async function StartPage({ searchParams }: PageProps<"/start">) {
  await connection();
  const supabase = await createClient();
  const { userId, me } = await getSession(supabase);
  if (!userId) redirect("/login");
  if (!me) return <NotStaff />;

  const { change, return: back } = await searchParams;
  // Came from Home ("Choose site" / "Change site"): go back there after.
  const returnTo = back === "home" ? "/home" : "/records";
  const [shift, clearance] = await Promise.all([
    getCurrentShift(supabase, userId),
    // Vomiting or diarrhoea reported and not cleared: start_shift will refuse.
    supabase.rpc("needs_clearance"),
  ]);
  const needsClearance = clearance.data === true;
  if (shift && change !== "1") redirect(returnTo);

  // RLS lets every signed-in person read active sites (for this picker).
  const { data: sites, error } = await supabase
    .from("sites")
    .select("id, name, kind")
    .eq("active", true)
    .order("name");

  return (
    <main className="mx-auto w-full max-w-md px-4 py-6">
      <p className="text-[13px] text-muted">Kia ora, {me.name}</p>
      <h1 className="mt-1 text-3xl font-bold">
        Choose site
      </h1>
      <p className="mt-1 text-sm text-muted">
        {shift
          ? `Today you're at ${shift.site.name}. Pick another site to add records there instead.`
          : "Where are you working today? This decides which site's records you can add. Enter your hours on Time."}
      </p>
      {needsClearance && (
        <div role="alert" className="mt-4 rounded-[14px] border border-warning/40 bg-warning-light p-4">
          <p className="font-semibold text-warning">Your manager needs to clear you to return to work after illness</p>
          <p className="mt-1 text-sm text-ink">
            You reported vomiting or diarrhoea. For food safety you can&apos;t choose a site or add hours for later
            days until a manager clears you, usually 48 hours after it stops.
          </p>
          <Link
            href="/leave"
            className="mt-2 inline-flex min-h-12 items-center text-sm font-semibold text-primary hover:text-primary-dark"
          >
            See your leave
          </Link>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-red-800">
          Could not load sites: {error.message}
        </p>
      )}

      <ul className="mt-5 space-y-3">
        {(sites ?? []).map((site) => {
          const here = shift?.site.id === site.id;
          return (
            <li key={site.id}>
              {/* Each card is its own form: tapping it calls start_shift for
                  that site. .bind fills in the site id on the server. */}
              <form action={startShift.bind(null, site.id, returnTo)}>
                <button
                  type="submit"
                  className={`flex min-h-20 w-full items-center gap-3 rounded-[14px] border px-4 py-4 text-left text-ink hover:border-muted active:bg-primary-light ${
                    here ? "border-primary bg-primary-light" : "border-line bg-white"
                  }`}
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-lg leading-snug font-semibold text-ink">{site.name}</span>
                    <span className="text-sm text-muted">{kindLabel(site.kind)}</span>
                  </span>
                  {here ? (
                    <span className="shrink-0 rounded-full bg-primary px-2.5 py-1 text-xs font-semibold text-white">
                      You&apos;re here
                    </span>
                  ) : (
                    <svg
                      aria-hidden="true"
                      className="h-5 w-5 shrink-0 text-muted"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                  )}
                </button>
              </form>
            </li>
          );
        })}
      </ul>

      {(shift || isManager(me) || returnTo === "/home") && (
        <Link
          href={returnTo}
          className="mt-4 flex min-h-12 items-center justify-center text-sm font-medium text-primary hover:text-primary-dark"
        >
          {shift
            ? "Stay where I am"
            : returnTo === "/home"
              ? "Back to Home"
              : "Just view records (don't choose a site)"}
        </Link>
      )}
    </main>
  );
}
