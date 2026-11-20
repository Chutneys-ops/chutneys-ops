import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { BackLink } from "@/components/back-link";
import { NotStaff } from "@/components/not-staff";
import { aucklandDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { getSession, isManager } from "@/lib/supabase/session";
import { loadPackInput } from "@/lib/supabase/verifier-pack";
import {
  buildPack,
  MAX_PACK_DAYS,
  monthFromPackPath,
  monthLabel,
  PACK_BUCKET,
  packSummary,
  packTotals,
  rangeError,
  rangeLabel,
} from "@/lib/verifier-pack";

// More > Verifier pack (managers and the owner): choose a site and dates,
// check the summary, then open or download the PDF. The owner also sees the
// monthly copies. The PDF route checks the role again on the server.

const inputClass =
  "mt-1.5 min-h-12 w-full rounded-xl border border-line bg-white px-3 text-base text-ink focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Stored monthly copies, newest first. Storage RLS: owner only. */
async function monthlyCopies(supabase: Supabase): Promise<{ path: string; month: string }[]> {
  const bucket = supabase.storage.from(PACK_BUCKET);
  const { data: years } = await bucket.list("", { sortBy: { column: "name", order: "desc" } });
  const copies: { path: string; month: string }[] = [];
  for (const year of (years ?? []).filter((y) => /^\d{4}$/.test(y.name))) {
    const { data: files } = await bucket.list(year.name, { sortBy: { column: "name", order: "desc" } });
    for (const f of files ?? []) {
      const path = `${year.name}/${f.name}`;
      const month = monthFromPackPath(path);
      if (month) copies.push({ path, month });
    }
  }
  return copies;
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export default async function VerifierPackPage({ searchParams }: PageProps<"/more/verifier-pack">) {
  await connection();
  const supabase = await createClient();
  const { userId, me } = await getSession(supabase);
  if (!userId) redirect("/login");
  if (!me) return <NotStaff />;
  if (!isManager(me)) notFound();

  const params = await searchParams;
  const today = aucklandDate();
  const from = first(params.from) ?? `${today.slice(0, 7)}-01`;
  const to = first(params.to) ?? today;
  const wantedSite = first(params.site) ?? "all";
  const site = wantedSite === "all" || UUID_RE.test(wantedSite) ? wantedSite : "all";
  const submitted = params.from !== undefined;

  const { data: siteRows } = await supabase.from("sites").select("id, name, active").order("name");
  const sites = (siteRows ?? []) as { id: string; name: string; active: boolean }[];

  const problem = submitted ? rangeError(from, to, today) : null;
  let summary: { lines: ReturnType<typeof packSummary>; totals: ReturnType<typeof packTotals>; sickness: number; training: number } | null = null;
  let loadError: string | null = null;
  if (submitted && !problem) {
    try {
      const pack = buildPack(await loadPackInput(supabase, { siteId: site === "all" ? null : site, from, to }));
      summary = { lines: packSummary(pack), totals: packTotals(pack), sickness: pack.sickness.length, training: pack.training.length };
    } catch (error) {
      loadError = (error as Error).message;
    }
  }
  const query = new URLSearchParams({ site, from, to }).toString();
  const copies = me.role === "owner" ? await monthlyCopies(supabase) : [];

  return (
    <main className="mx-auto w-full max-w-md px-4 pt-2 pb-6">
      <BackLink />
      <h1 className="text-3xl font-bold">Verifier pack</h1>
      <p className="mt-1 text-sm text-muted">
        Every food safety record for a date range as one PDF for the council verifier: each day&apos;s sheets, out-of-range
        readings with their corrective actions, corrections, sign-offs and days with no record, plus staff sickness
        exclusions and training. Up to {MAX_PACK_DAYS} days at a time.
      </p>

      <form method="get" className="mt-4 space-y-4 rounded-[14px] border border-line bg-white p-4">
        <div>
          <label htmlFor="pack-site" className="block text-sm font-semibold text-ink">
            Site
          </label>
          <select id="pack-site" name="site" defaultValue={site} className={inputClass}>
            <option value="all">All sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.active ? s.name : `${s.name} (closed)`}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="pack-from" className="block text-sm font-semibold text-ink">
              From
            </label>
            <input id="pack-from" name="from" type="date" required defaultValue={from} max={today} className={inputClass} />
          </div>
          <div>
            <label htmlFor="pack-to" className="block text-sm font-semibold text-ink">
              To
            </label>
            <input id="pack-to" name="to" type="date" required defaultValue={to} max={today} className={inputClass} />
          </div>
        </div>
        <button
          type="submit"
          className="min-h-[50px] w-full rounded-xl bg-primary px-4 text-base font-semibold text-white hover:bg-primary-dark"
        >
          Check records
        </button>
      </form>

      {problem && (
        <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-red-800">
          {problem}
        </p>
      )}
      {loadError && (
        <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-red-800">
          Could not load the records: {loadError}
        </p>
      )}

      {summary && (
        <section className="mt-5 rounded-[14px] border border-line bg-white p-4" aria-labelledby="summary-heading">
          <h2 id="summary-heading" className="text-lg font-semibold">
            {rangeLabel(from, to)}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {plural(summary.totals.entries, "entry", "entries")}, {summary.totals.outOfRange} out of range,{" "}
            {plural(summary.totals.missingDays, "day")} with no record, {plural(summary.totals.unsignedDays, "sheet")} not
            signed off. {plural(summary.sickness, "sickness exclusion")}, {plural(summary.training, "training record")}.
          </p>

          {summary.lines.length === 0 ? (
            <p className="mt-3 text-sm text-ink">No food safety records for this site and period.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {summary.lines.map((line) => (
                <li key={line.id} className="py-2.5">
                  <p className="font-semibold text-ink">{line.name}</p>
                  <p className="text-sm text-muted">
                    {plural(line.counts.entries, "entry", "entries")}
                    {line.counts.outOfRange > 0 && `, ${line.counts.outOfRange} out of range`}
                    {line.counts.unsignedDays > 0 && `, ${plural(line.counts.unsignedDays, "sheet")} not signed off`}
                  </p>
                  {line.missing.length > 0 && (
                    <p className="mt-0.5 text-sm font-medium text-warning">
                      No record: {line.missing.map((m) => `${m.title} (${plural(m.days, "day")})`).join(", ")}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 grid grid-cols-2 gap-2">
            {/* Plain links: the phone opens the PDF in its own viewer. */}
            <a
              href={`/more/verifier-pack/pdf?${query}`}
              target="_blank"
              rel="noopener"
              className="flex min-h-[50px] items-center justify-center rounded-xl bg-primary px-4 text-base font-semibold text-white hover:bg-primary-dark"
            >
              Open PDF
            </a>
            <a
              href={`/more/verifier-pack/pdf?${query}&download=1`}
              className="flex min-h-[50px] items-center justify-center rounded-xl border border-primary/40 bg-primary-light px-4 text-base font-semibold text-primary-dark"
            >
              Download
            </a>
          </div>
        </section>
      )}

      {me.role === "owner" && (
        <section className="mt-5" aria-labelledby="monthly-heading">
          <h2 id="monthly-heading" className="mb-2 text-[13px] font-semibold tracking-wide text-muted uppercase">
            Monthly copies
          </h2>
          <p className="mb-2 text-sm text-muted">
            Every site&apos;s pack for the month before, made automatically on the 1st and kept privately.
          </p>
          {copies.length === 0 ? (
            <p className="rounded-[14px] border border-line bg-white p-4 text-sm text-muted">No monthly copies yet.</p>
          ) : (
            <ul className="divide-y divide-line rounded-[14px] border border-line bg-white">
              {copies.map((c) => (
                <li key={c.path}>
                  {/* A plain link: the route redirects to a short-lived Storage URL. */}
                  <a
                    href={`/more/verifier-pack/monthly?${new URLSearchParams({ file: c.path }).toString()}`}
                    className="flex min-h-14 items-center justify-between px-4 py-3 font-semibold text-ink hover:bg-cream"
                  >
                    {monthLabel(c.month)}
                    <span className="text-sm font-normal text-muted">Download PDF</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
