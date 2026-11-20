import Link from "next/link";
import { connection } from "next/server";
import { NotStaff } from "@/components/not-staff";
import { formatYmd } from "@/lib/dates";
import { describeSheetStatus, type SheetTone } from "@/lib/records";
import { createClient } from "@/lib/supabase/server";
import { kindLabel } from "@/lib/supabase/session";
import { getRecordsView, type RecordsView } from "./view";

// Pill colours. The text always says the status too, so colour is never the only signal.
const toneClass: Record<SheetTone, string> = {
  done: "bg-primary-light text-primary-dark",
  "in-progress": "bg-warning-light text-warning",
  "not-started": "bg-stone-100 text-stone-700",
};

type TemplateRow = { code: string; title: string; period: "daily" | "event" };
type SheetRow = {
  template_code: string;
  signed_off_at: string | null;
  record_entries: { out_of_range: boolean }[];
};

/** Managers and owner: pick any site and day. A plain GET form, so the
 *  choice lives in the URL (?site=..&date=..) and works with Back. */
function ManagerFilter({ view }: { view: RecordsView }) {
  return (
    <form method="get" className="mt-4 grid grid-cols-[1fr_auto] gap-2 rounded-[14px] border border-line bg-white p-3">
      <label className="col-span-2 text-[13px] font-semibold text-muted" htmlFor="filter-site">
        Viewing
      </label>
      <select
        id="filter-site"
        name="site"
        defaultValue={view.site.id}
        className="col-span-2 min-h-12 rounded-xl border border-line bg-white px-3 text-base text-ink"
      >
        {view.sites.map((site) => (
          <option key={site.id} value={site.id}>
            {site.name}
            {site.active ? "" : " (closed)"}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor="filter-date">
        Date
      </label>
      <input
        id="filter-date"
        name="date"
        type="date"
        max={view.today}
        defaultValue={view.date}
        className="min-h-12 rounded-xl border border-line bg-white px-3 text-base text-ink"
      />
      <button
        type="submit"
        className="min-h-12 rounded-xl bg-primary px-5 font-semibold text-white hover:bg-primary-dark"
      >
        Show
      </button>
    </form>
  );
}

export default async function RecordsPage({ searchParams }: PageProps<"/records">) {
  await connection();
  const supabase = await createClient();
  const view = await getRecordsView(supabase, await searchParams);
  if (!view) return <NotStaff />;

  // Templates for this kind of site, and that day's sheets with just enough
  // of each entry to count them and spot anything out of range.
  const [templatesResult, sheetsResult] = await Promise.all([
    supabase
      .from("record_templates")
      .select("code, title, period")
      .eq("active", true)
      .contains("site_kinds", [view.site.kind])
      .order("sort_order"),
    supabase
      .from("record_sheets")
      .select("template_code, signed_off_at, record_entries(out_of_range)")
      .eq("site_id", view.site.id)
      .eq("sheet_date", view.date),
  ]);

  const error = templatesResult.error ?? sheetsResult.error;
  const templates = (templatesResult.data ?? []) as TemplateRow[];
  const sheetByCode = new Map(
    ((sheetsResult.data ?? []) as SheetRow[]).map((sheet) => [sheet.template_code, sheet]),
  );
  const sections: { title: string; period: TemplateRow["period"] }[] = [
    { title: "Daily records", period: "daily" },
    { title: "When it happens", period: "event" },
  ];
  const viewOnlyReason = view.date === view.today ? "you haven't chosen this site today" : "this is a past day";

  return (
    <main className="mx-auto w-full max-w-md px-4 pt-4 pb-6">
      <p className="text-[13px] text-muted">{formatYmd(view.date)}</p>
      <h1 className="mt-1 text-[26px] leading-tight font-bold">{view.site.name}</h1>
      <p className="text-sm text-muted">Food safety records · {kindLabel(view.site.kind)}</p>

      {view.isManager && <ManagerFilter view={view} />}
      {view.isManager && !view.canAdd && (
        <p className="mt-3 rounded-xl border border-line bg-white px-3.5 py-3 text-sm text-muted">
          View only: {viewOnlyReason}. You can still verify and sign sheets.
        </p>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-red-800">
          Could not load records: {error.message}
        </p>
      )}

      {sections.map(({ title, period }) => {
        const list = templates.filter((t) => t.period === period);
        if (list.length === 0) return null;
        return (
          <section key={period} className="mt-5">
            <h2 className="text-[13px] font-semibold text-muted">{title}</h2>
            <ul className="mt-2.5 space-y-2.5">
              {list.map((template) => {
                const sheet = sheetByCode.get(template.code);
                const entries = sheet?.record_entries ?? [];
                const status = describeSheetStatus({
                  entryCount: entries.length,
                  anyOutOfRange: entries.some((e) => e.out_of_range),
                  signedOffAt: sheet?.signed_off_at ?? null,
                });
                return (
                  <li key={template.code}>
                    <Link
                      href={`/records/${template.code}${view.query}`}
                      className="flex min-h-16 items-center gap-3 rounded-[14px] border border-line bg-white px-4 py-3.5 text-ink hover:border-muted active:bg-primary-light"
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="text-[15px] font-semibold">{template.title}</span>
                        {status.warning && (
                          <span className="inline-flex w-fit items-center gap-1 rounded-full bg-warning-light px-2 py-0.5 text-xs font-semibold text-warning">
                            <span aria-hidden="true">⚠</span> Out of range
                          </span>
                        )}
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${toneClass[status.tone]}`}
                      >
                        {status.text}
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
          </section>
        );
      })}
    </main>
  );
}
