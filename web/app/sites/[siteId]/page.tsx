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
    return (
      <main className="mx-auto w-full max-w-md px-4 py-6">
        <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">
          Could not load the checklist: {message}
        </p>
      </main>
    );
  }

  const items = (itemsResult.data ?? []) as Item[];
  const run = runResult.data as Run | null;

  const ticks = new Map((run?.checklist_ticks ?? []).map((t) => [t.item_id, t]));
  const done = items.filter((item) => ticks.has(item.id)).length;
  const allDone = items.length > 0 && done === items.length;
  const locked = Boolean(run?.submitted_at);

  return (
    // pb-32 leaves room for the submit bar fixed to the bottom of the screen.
    <main className="mx-auto w-full max-w-md px-4 pt-2 pb-32">
      <Link
        href="/sites"
        className="-ml-1 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary hover:text-primary-dark"
      >
        <svg
          aria-hidden="true"
          className="h-[18px] w-[18px]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M15 6l-6 6 6 6" />
        </svg>
        All sites
      </Link>

      <p className="mt-1 text-[13px] text-muted">{aucklandDay()}</p>
      <h1 className="mt-1 text-[26px] leading-tight font-bold">{site.name}</h1>
      <p className="text-sm text-muted">Opening checklist</p>

      <div className="mt-4 flex justify-between gap-3 text-[13px] text-muted">
        <span className="font-medium text-ink" aria-live="polite">
          {done} of {items.length} done
        </span>
        <span>Each tick saves the time and your name</span>
      </div>
      {items.length > 0 && (
        // Decorative: the "x of y done" text above says the same thing.
        <div aria-hidden="true" className="mt-2 h-2 overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${Math.round((done / items.length) * 100)}%` }}
          />
        </div>
      )}

      {items.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-line bg-white p-4 text-muted">
          There is no opening checklist for this kind of site yet.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
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

      {/* Submit bar. The bottom padding grows on phones with a home-indicator
          bar (env(safe-area-inset-bottom)) so the button isn't hidden. */}
      <div className="fixed inset-x-0 bottom-0 border-t border-line bg-cream px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-md">
          {locked && run?.submitted_at ? (
            <p
              role="status"
              className="rounded-xl border border-primary/30 bg-primary-light px-3.5 py-3 text-center text-sm font-medium text-primary-dark"
            >
              Submitted {aucklandTime(run.submitted_at)}
              {run.submitter ? ` by ${run.submitter.name}` : ""}
            </p>
          ) : (
            <form action={submitChecklist.bind(null, siteId)}>
              <button
                type="submit"
                disabled={!allDone}
                className="min-h-[50px] w-full rounded-xl bg-primary px-4 text-base font-semibold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:bg-line disabled:text-ink"
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
