import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { aucklandDate, aucklandDay, aucklandTime, previousDate } from "@/lib/dates";
import {
  formatValue,
  groupEntries,
  groupValues,
  pendingLaterFields,
  type RecordField,
} from "@/lib/records";
import { addEntry, signOff } from "./actions";
import { EntryForm } from "./entry-form";
import { EntryGroupCard, type EntryRow } from "./entry-group";
import { SignOffForm } from "./sign-off-form";

type Sheet = {
  id: string;
  sheet_date: string;
  started_at: string;
  signed_off_at: string | null;
  starter: { name: string } | null;
  signer: { name: string } | null;
  record_entries: EntryRow[];
};

// "recorder:staff!recorded_by(name)" follows the recorded_by foreign key to
// staff and calls the result "recorder" (same trick as the checklist page).
const SHEET_SELECT = `
  id, sheet_date, started_at, signed_off_at,
  starter:staff!started_by(name),
  signer:staff!signed_off_by(name),
  record_entries(id, values, out_of_range, corrective_action, recorded_at,
    amends_entry_id, continues_entry_id, note, recorder:staff!recorded_by(name))
`;

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5 rounded-[14px] border border-line bg-white p-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** "Add next reading": a collapsed follow-up form under a record. */
function NextReading({ children }: { children: ReactNode }) {
  return (
    <details className="group mt-3 border-t border-line pt-3">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-center rounded-xl border border-primary/40 bg-primary-light px-4 font-semibold text-primary-dark group-open:mb-3">
        Add next reading
      </summary>
      {children}
    </details>
  );
}

export default async function RecordSheetPage({
  params,
}: PageProps<"/sites/[siteId]/records/[code]">) {
  await connection();
  const { siteId, code } = await params;
  const supabase = await createClient();

  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) redirect("/login");

  const today = aucklandDate();
  const yesterday = previousDate(today);

  const [siteResult, templateResult, sheetsResult, unitsResult, meResult] = await Promise.all([
    supabase.from("sites").select("id, name, kind").eq("id", siteId).maybeSingle(),
    supabase
      .from("record_templates")
      .select("code, title, description, period, fields, site_kinds, active")
      .eq("code", code)
      .maybeSingle(),
    supabase
      .from("record_sheets")
      .select(SHEET_SELECT)
      .eq("site_id", siteId)
      .eq("template_code", code)
      .in("sheet_date", [today, yesterday]),
    supabase.from("temp_units").select("id, name").eq("site_id", siteId).order("name"),
    supabase.from("staff").select("role").eq("id", userId).maybeSingle(),
  ]);

  const site = siteResult.data;
  const template = templateResult.data;
  // Not your site, no such template, or not one for this kind of site: 404.
  if (!site || !template || !template.active || !template.site_kinds.includes(site.kind)) notFound();

  const error = sheetsResult.error ?? unitsResult.error;
  if (error) {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-6">
        <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">
          Could not load this record: {error.message}
        </p>
      </main>
    );
  }

  const fields = template.fields as RecordField[];
  const units = unitsResult.data ?? [];
  const unitNames = Object.fromEntries(units.map((u) => [u.id, u.name]));
  const sheets = (sheetsResult.data ?? []) as unknown as Sheet[];
  const sheet = sheets.find((s) => s.sheet_date === today) ?? null;
  const yesterdaySheet = sheets.find((s) => s.sheet_date === yesterday) ?? null;

  const entries = sheet?.record_entries ?? [];
  const groups = groupEntries(entries);
  const signed = Boolean(sheet?.signed_off_at);
  const canSign = meResult.data?.role === "manager" || meResult.data?.role === "owner";
  const hasLater = fields.some((f) => f.later);

  // Batter made last night is ready this morning: offer yesterday's
  // unfinished records too, while that sheet isn't signed off.
  const carriedOver =
    hasLater && yesterdaySheet && !yesterdaySheet.signed_off_at
      ? groupEntries(yesterdaySheet.record_entries).filter(
          (g) => pendingLaterFields(fields, groupValues(g)).length > 0,
        )
      : [];

  // Labels for the "which entry are you correcting?" list.
  const correctable = entries
    .filter((e) => !e.amends_entry_id)
    .map((e) => {
      const summary = fields
        .filter((f) => e.values[f.key] !== undefined && e.values[f.key] !== null)
        .slice(0, 2)
        .map((f) => formatValue(f, e.values[f.key], unitNames))
        .join(", ");
      return { id: e.id, label: `${aucklandTime(e.recorded_at)} · ${summary}` };
    });

  function followUpForm(sheetId: string, group: (typeof groups)[number]) {
    const values = groupValues(group);
    const pending = pendingLaterFields(fields, values);
    if (pending.length === 0) return null;
    return (
      <NextReading>
        <EntryForm
          action={addEntry.bind(null, siteId, code, {
            kind: "followup",
            sheetId,
            entryId: group.root.entry.id,
          })}
          fields={pending}
          units={units}
          mode="followup"
          baseValues={values}
          submitLabel="Save reading"
        />
      </NextReading>
    );
  }

  return (
    <main className="mx-auto w-full max-w-md px-4 pt-2 pb-8">
      <Link
        href={`/sites/${siteId}/records`}
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
        All records
      </Link>

      <p className="mt-1 text-[13px] text-muted">{aucklandDay()}</p>
      <h1 className="mt-1 text-[26px] leading-tight font-bold">{template.title}</h1>
      <p className="text-sm text-muted">{site.name}</p>
      {template.description && <p className="mt-2 text-[15px] text-ink">{template.description}</p>}

      <p className="mt-3 text-[13px] text-muted">
        {sheet
          ? `Started ${aucklandTime(sheet.started_at)} by ${sheet.starter?.name ?? "a team member"}`
          : "Not started yet today"}
      </p>

      {signed && sheet?.signed_off_at && (
        <p
          role="status"
          className="mt-3 rounded-xl border border-primary/30 bg-primary-light px-3.5 py-3 text-center text-sm font-medium text-primary-dark"
        >
          Signed off {aucklandTime(sheet.signed_off_at)}
          {sheet.signer ? ` by ${sheet.signer.name}` : ""}
        </p>
      )}

      {carriedOver.length > 0 && yesterdaySheet && (
        <section className="mt-5">
          <h2 className="text-[13px] font-semibold text-muted">Carried over from yesterday</h2>
          <ul className="mt-2.5 space-y-2.5">
            {carriedOver.map((group) => (
              <EntryGroupCard key={group.root.entry.id} group={group} fields={fields} unitNames={unitNames}>
                {followUpForm(yesterdaySheet.id, group)}
              </EntryGroupCard>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-5">
        <h2 className="text-[13px] font-semibold text-muted">Today&apos;s entries</h2>
        {groups.length === 0 ? (
          <p className="mt-2.5 rounded-xl border border-dashed border-line bg-white p-4 text-muted">
            No entries yet today.
          </p>
        ) : (
          <ul className="mt-2.5 space-y-2.5">
            {groups.map((group) => (
              <EntryGroupCard key={group.root.entry.id} group={group} fields={fields} unitNames={unitNames}>
                {!signed && sheet && followUpForm(sheet.id, group)}
              </EntryGroupCard>
            ))}
          </ul>
        )}
      </section>

      {!signed && (
        <Card title="Add an entry">
          <EntryForm
            action={addEntry.bind(null, siteId, code, { kind: "new" })}
            fields={fields}
            units={units}
            mode="new"
            submitLabel="Save entry"
          />
        </Card>
      )}

      {!signed && canSign && sheet && entries.length > 0 && (
        <Card title="Verify and sign">
          <p className="mb-3 text-sm text-muted">
            Check the entries above, then sign with your PIN. After that, only corrections can be added.
          </p>
          <SignOffForm action={signOff.bind(null, siteId, code, sheet.id)} />
        </Card>
      )}

      {sheet && correctable.length > 0 && (
        <details className="group mt-5 rounded-[14px] border border-line bg-white">
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between px-4 font-semibold text-ink">
            Add correction
            <svg
              aria-hidden="true"
              className="h-[18px] w-[18px] text-muted transition-transform group-open:rotate-90"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
          </summary>
          <div className="border-t border-line p-4">
            <p className="mb-3 text-sm text-muted">
              Entries can&apos;t be edited or deleted. Re-enter the right values here and say what was
              wrong; the original stays on the record.
            </p>
            <EntryForm
              action={addEntry.bind(null, siteId, code, { kind: "correction", sheetId: sheet.id })}
              fields={fields}
              units={units}
              mode="correction"
              correctable={correctable}
              submitLabel="Save correction"
            />
          </div>
        </details>
      )}
    </main>
  );
}
