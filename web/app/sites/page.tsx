import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { aucklandDate } from "@/lib/dates";
import { describeStatus, type StatusTone } from "@/lib/checklist-status";

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
    return <p className="p-6">Could not load sites: {error.message}</p>;
  }

  const sites = sitesResult.data;
  if (!sites || sites.length === 0) {
    return <p className="p-6">No sites yet.</p>;
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
    <main className="mx-auto w-full max-w-md p-4">
      <h1 className="mb-4 text-2xl font-bold">Sites</h1>

      <ul className="space-y-2">
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
                className="block rounded-lg border p-3 active:bg-gray-100"
              >
                <span className="block font-semibold">{site.name}</span>
                <span className="text-sm text-gray-500">{site.kind}</span>
                <span className={`block text-sm ${toneClass[status.tone]}`}>
                  Opening: {status.text}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      <form action={logout}>
        <button className="mt-6 py-2 underline">Sign out</button>
      </form>
    </main>
  );
}
