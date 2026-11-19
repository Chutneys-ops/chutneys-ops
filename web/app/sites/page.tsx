import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { aucklandDate, aucklandDay } from "@/lib/dates";
import { describeStatus, type StatusTone } from "@/lib/checklist-status";

// Colours for the status pill on each site card. The pill's shape is on the
// <span> below. Every pair passes WCAG AA (4.5:1) and the text says the
// status too, so colour is never the only signal.
const toneClass: Record<StatusTone, string> = {
  done: "bg-primary-light text-primary-dark", // submitted: green, ~8:1
  "in-progress": "bg-warning-light text-warning", // started: amber, ~6.3:1
  "not-started": "bg-stone-100 text-stone-700", // grey, ~9:1
  none: "border border-line bg-white text-muted", // no checklist: quiet grey, ~6:1
};

type RunSummary = {
  site_id: string;
  submitted_at: string | null;
  checklist_ticks: { item_id: string }[];
};

export default async function SitesPage({ searchParams }: PageProps<"/sites">) {
  await connection();
  // The Records tab sends you here with ?pick=records when you aren't on a
  // site yet: the cards then go to each site's records instead.
  const { pick } = await searchParams;
  const pickingRecords = pick === "records";
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
      <p className="mt-4 text-[13px] font-semibold text-muted">
        {pickingRecords ? "Pick a site for food safety records" : "Opening checklists"}
      </p>

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
                href={pickingRecords ? `/sites/${site.id}/records` : `/sites/${site.id}`}
                className="flex min-h-16 items-center gap-3 rounded-[14px] border border-line bg-white px-4 py-3.5 text-ink hover:border-muted active:bg-primary-light"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[15px] font-semibold">{site.name}</span>
                  <span className="text-[13px] capitalize text-muted">{site.kind}</span>
                </span>
                {/* The "Opening checklists" heading above already says which
                    checklist this is, so the pill shows just the status.
                    shrink-0 + nowrap keep it on one line; the name wraps instead. */}
                {!pickingRecords && (
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${toneClass[status.tone]}`}
                  >
                    {status.text}
                  </span>
                )}
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
