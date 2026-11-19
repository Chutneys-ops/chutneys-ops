import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { NotStaff } from "@/components/not-staff";
import { createClient } from "@/lib/supabase/server";
import { getCurrentShift, getSession, isManager, kindLabel } from "@/lib/supabase/session";
import { startShift } from "../shift-actions";

// "Where are you working today?" Picking a site clocks you in there.
// Already clocked in? You go straight to Records, unless you came here
// with ?change=1 (the "Change site" link).
export default async function StartPage({ searchParams }: PageProps<"/start">) {
  await connection();
  const supabase = await createClient();
  const { userId, me } = await getSession(supabase);
  if (!userId) redirect("/login");
  if (!me) return <NotStaff />;

  const { change } = await searchParams;
  const shift = await getCurrentShift(supabase, userId);
  if (shift && change !== "1") redirect("/records");

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
        {shift ? "Where are you working now?" : "Where are you working today?"}
      </h1>
      <p className="mt-1 text-sm text-muted">
        {shift
          ? `You're on shift at ${shift.site.name}. Picking another site clocks you out there and in here.`
          : "Picking a site clocks you in there."}
      </p>

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
              <form action={startShift.bind(null, site.id)}>
                <button
                  type="submit"
                  className={`flex min-h-20 w-full items-center gap-3 rounded-[14px] border px-4 py-4 text-left hover:border-muted active:bg-primary-light ${
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

      {(shift || isManager(me)) && (
        <Link
          href="/records"
          className="mt-4 flex min-h-12 items-center justify-center text-sm font-medium text-primary hover:text-primary-dark"
        >
          {shift ? "Stay where I am" : "Just view records (don't clock in)"}
        </Link>
      )}
    </main>
  );
}
