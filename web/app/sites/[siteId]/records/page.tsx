import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { aucklandDate, aucklandDay } from "@/lib/dates";
import { describeSheetStatus, type SheetTone } from "@/lib/records";

// Same pill colours as the sites list. The text always says the status too.
const toneClass: Record<SheetTone, string> = {
  done: "bg-primary-light text-primary-dark",
  "in-progress": "bg-warning-light text-warning",
  "not-started": "bg-stone-100 text-stone-700",
};

type TemplateRow = { code: string; title: string; description: string | null; period: "daily" | "event" };
type SheetRow = {
  template_code: string;
  signed_off_at: string | null;
  record_entries: { out_of_range: boolean }[];
};

export default async function RecordsPage({ params }: PageProps<"/sites/[siteId]/records">) {
  await connection();
  const { siteId } = await params;
  const supabase = await createClient();

  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) redirect("/login");

  const { data: site } = await supabase
    .from("sites")
    .select("id, name, kind")
    .eq("id", siteId)
    .maybeSingle();
  if (!site) notFound();

  // Templates for this kind of site, and today's sheets with just enough of
  // each entry to count them and spot anything out of range.
  const [templatesResult, sheetsResult] = await Promise.all([
    supabase
      .from("record_templates")
      .select("code, title, description, period")
      .eq("active", true)
      .contains("site_kinds", [site.kind])
      .order("sort_order"),
    supabase
      .from("record_sheets")
      .select("template_code, signed_off_at, record_entries(out_of_range)")
      .eq("site_id", siteId)
      .eq("sheet_date", aucklandDate()),
  ]);

  const error = templatesResult.error ?? sheetsResult.error;
  if (error) {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-6">
        <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">
          Could not load records: {error.message}
        </p>
      </main>
    );
  }

  const templates = (templatesResult.data ?? []) as TemplateRow[];
  const sheetByCode = new Map(
    ((sheetsResult.data ?? []) as SheetRow[]).map((sheet) => [sheet.template_code, sheet]),
  );

  const sections: { title: string; period: TemplateRow["period"] }[] = [
    { title: "Daily records", period: "daily" },
    { title: "When it happens", period: "event" },
  ];

  return (
    <main className="mx-auto w-full max-w-md px-4 pt-2 pb-6">
      <Link
        href={`/sites/${siteId}`}
        className="-ml-1 inline-flex min-h-12 items-center gap-1 text-sm font-medium text-primary hover:text-primary-dark"
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
        Opening checklist
      </Link>

      <p className="mt-1 text-[13px] text-muted">{aucklandDay()}</p>
      <h1 className="mt-1 text-[26px] leading-tight font-bold">{site.name}</h1>
      <p className="text-sm text-muted">Food safety records</p>

      {templates.length === 0 && (
        <p className="mt-4 rounded-xl border border-dashed border-line bg-white p-4 text-muted">
          There are no record templates for this kind of site yet.
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
                      href={`/sites/${siteId}/records/${template.code}`}
                      className="flex min-h-16 items-center gap-3 rounded-[14px] border border-line bg-white px-4 py-3.5 text-ink hover:border-muted active:bg-primary-light"
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="text-[15px] font-semibold">{template.title}</span>
                        {status.warning && (
                          // Text plus an icon, so it isn't colour alone.
                          <span className="inline-flex w-fit items-center gap-1 rounded-full bg-warning-light px-2 py-0.5 text-xs font-semibold text-warning">
                            <span aria-hidden="true">⚠</span> Out of range today
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
