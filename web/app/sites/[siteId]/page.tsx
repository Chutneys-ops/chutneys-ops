import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { aucklandDate, aucklandDay, aucklandTime } from "@/lib/dates";
import { ChecklistRow } from "./checklist-row";
import { submitChecklist } from "./actions";

type Item = { id: string; label: string };
type Tick = { item_id: string; ticked_at: string; ticker: { name: string } | null };
type Run = {
  id: string;
  submitted_at: string | null;
  submitter: { name: string } | null;
  checklist_ticks: Tick[];
};

export default async function SiteChecklistPage({ params }: PageProps<"/sites/[siteId]">) {
  // This page depends on the clock and the logged-in user, so never prerender it.
  await connection();
  const { siteId } = await params;
  const supabase = await createClient();

  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) redirect("/login");

  // RLS returns no row if this isn't one of your sites, so that's a 404 too.
  const { data: site } = await supabase
    .from("sites")
    .select("id, name, kind")
    .eq("id", siteId)
    .maybeSingle();
  if (!site) notFound();

  // Items for this kind of site, and today's run (if anyone has started it)
  // with its ticks. "ticker:staff!ticked_by(name)" follows the ticked_by
  // foreign key to the staff table and names the result "ticker".
  const [itemsResult, runResult] = await Promise.all([
    supabase
      .from("checklist_items")
      .select("id, label")
      .eq("site_kind", site.kind)
      .eq("checklist", "opening")
      .order("sort_order"),
    supabase
      .from("checklist_runs")
      .select(
        "id, submitted_at, submitter:staff!submitted_by(name), checklist_ticks(item_id, ticked_at, ticker:staff!ticked_by(name))",
      )
      .eq("site_id", siteId)
      .eq("checklist", "opening")
      .eq("run_date", aucklandDate())
      .maybeSingle(),
  ]);

  if (itemsResult.error || runResult.error) {
    const message = (itemsResult.error ?? runResult.error)?.message;
    return <p className="p-4">Could not load the checklist: {message}</p>;
  }

  const items = (itemsResult.data ?? []) as Item[];
  const run = runResult.data as Run | null;

  const ticks = new Map((run?.checklist_ticks ?? []).map((t) => [t.item_id, t]));
  const done = items.filter((item) => ticks.has(item.id)).length;
  const allDone = items.length > 0 && done === items.length;
  const locked = Boolean(run?.submitted_at);

  return (
    // pb-28 leaves room for the submit bar fixed to the bottom of the screen.
    <main className="mx-auto w-full max-w-md p-4 pb-28">
      <Link href="/sites" className="inline-block py-2 text-sm underline">
        ← All sites
      </Link>

      <h1 className="mt-2 text-xl font-bold">{site.name}</h1>
      <p className="text-sm text-gray-600">Opening checklist · {aucklandDay()}</p>

      <p className="mt-3 font-medium" aria-live="polite">
        {done} of {items.length} done
      </p>

      {items.length === 0 ? (
        <p className="mt-4">There is no opening checklist for this kind of site yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((item) => {
            const tick = ticks.get(item.id);
            return (
              <ChecklistRow
                key={item.id}
                siteId={siteId}
                item={item}
                tick={tick ? { tickedAt: tick.ticked_at, tickedBy: tick.ticker?.name ?? null } : null}
                locked={locked}
              />
            );
          })}
        </ul>
      )}

      <div className="fixed inset-x-0 bottom-0 border-t bg-white p-4">
        <div className="mx-auto max-w-md">
          {locked && run?.submitted_at ? (
            <p className="rounded-lg bg-green-100 p-3 text-center font-medium text-green-900">
              Submitted {aucklandTime(run.submitted_at)}
              {run.submitter ? ` by ${run.submitter.name}` : ""}
            </p>
          ) : (
            <form action={submitChecklist.bind(null, siteId)}>
              <button
                type="submit"
                disabled={!allDone}
                className="min-h-12 w-full rounded-lg bg-green-700 px-4 py-3 font-semibold text-white disabled:bg-gray-300 disabled:text-gray-600"
              >
                {allDone ? "Submit checklist" : `Tick all ${items.length} items to submit`}
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
