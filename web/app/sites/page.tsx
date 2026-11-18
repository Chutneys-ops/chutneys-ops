import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { aucklandDate, aucklandDay } from "@/lib/dates";
import { describeStatus, type StatusTone } from "@/lib/checklist-status";

// YOUR TURN: style the status label as a pill, like the demo's
// "3 of 8 done" badge (demo-source/StaffHome.dc.html line 49).
//   done        -> green  (try bg-primary-light / text-primary-dark)
//   in-progress -> amber  (try bg-warning-light / text-warning)
//   not-started -> grey
//   none        -> grey, quieter
// Keep every text/background pair at 4.5:1 contrast or better (WCAG AA).
// The shared pill shape (padding, rounding, font size) goes on the <span>
// further down; only the colours belong in this map.
const toneClass: Record<StatusTone, string> = {
  done: "text-green-700",
  "in-progress": "text-amber-700",
  "not-started": "text-gray-600",
  none: "text-gray-400",
};

type RunSummary = {
  site_id: string;
  submitted_at: string | null;
  checklist_ticks: { item_id: string }[];
};

export default async function SitesPage() {
  await connection();
  const supabase = await createClient();

  // Check who is logged in.
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) {
    redirect("/login");
  }

  // Sites, the opening items (to count per kind) and today's runs, in parallel.
  // RLS means each query only returns rows for your sites.
  const [sitesResult, itemsResult, runsResult] = await Promise.all([
    supabase.from("sites").select("id, name, kind, active").order("name"),
    supabase.from("checklist_items").select("site_kind").eq("checklist", "opening"),
    supabase
      .from("checklist_runs")
      .select("site_id, submitted_at, checklist_ticks(item_id)")
      .eq("checklist", "opening")
      .eq("run_date", aucklandDate()),
  ]);

  const error = sitesResult.error ?? itemsResult.error ?? runsResult.error;
  if (error) {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-6">
        <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">
          Could not load sites: {error.message}
        </p>
      </main>
    );
  }

  const sites = sitesResult.data;
  if (!sites || sites.length === 0) {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-6">
        <p className="rounded-xl border border-dashed border-line bg-white p-4 text-muted">
          No sites yet.
        </p>
      </main>
    );
  }

  // How many opening items each kind of site has, e.g. { truck: 8, cafe: 9 }.
  const itemsPerKind = new Map<string, number>();
  for (const item of itemsResult.data ?? []) {
    itemsPerKind.set(item.site_kind, (itemsPerKind.get(item.site_kind) ?? 0) + 1);
  }

  const runBySite = new Map(
    ((runsResult.data ?? []) as RunSummary[]).map((run) => [run.site_id, run]),
  );

  return (
    <main className="mx-auto w-full max-w-md px-4 py-6">
      <p className="text-[13px] text-muted">{aucklandDay()}</p>
      <h1 className="mt-1 text-3xl font-bold">Sites</h1>
      <p className="mt-4 text-[13px] font-semibold text-muted">Opening checklists</p>

      <ul className="mt-2.5 space-y-2.5">
        {sites.map((site) => {
          const run = runBySite.get(site.id);
          const status = describeStatus({
            done: run?.checklist_ticks.length ?? 0,
            total: itemsPerKind.get(site.kind) ?? 0,
            submittedAt: run?.submitted_at ?? null,
          });
          return (
            <li key={site.id}>
              <Link
                href={`/sites/${site.id}`}
                className="flex min-h-16 items-center gap-3 rounded-[14px] border border-line bg-white px-4 py-3.5 text-ink hover:border-muted active:bg-primary-light"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[15px] font-semibold">{site.name}</span>
                  <span className="text-[13px] capitalize text-muted">{site.kind}</span>
                </span>
                {/* YOUR TURN: the status label (see toneClass at the top). */}
                <span className={`block text-sm ${toneClass[status.tone]}`}>
                  Opening: {status.text}
                </span>
                <svg
                  aria-hidden="true"
                  className="h-[18px] w-[18px] shrink-0 text-muted"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
