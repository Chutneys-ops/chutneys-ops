import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { BackLink } from "@/components/back-link";
import { NotStaff } from "@/components/not-staff";
import {
  actorName,
  areaLabel,
  areaOptions,
  changeList,
  describeAudit,
  formatAuditValue,
  isKnownTable,
  type AuditEntry,
  type AuditLookups,
} from "@/lib/audit";
import { aucklandDate } from "@/lib/dates";
import { exportBounds } from "@/lib/hours-export";
import { isYmd } from "@/lib/leave";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/supabase/session";

const PAGE_SIZE = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const inputClass =
  "mt-1 min-h-12 w-full rounded-xl border border-line bg-white px-3 text-base text-ink focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none";

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function byId(rows: { id: string; name: string }[] | null): Record<string, string> {
  return Object.fromEntries((rows ?? []).map((r) => [r.id, r.name]));
}

const actionClass: Record<string, string> = {
  insert: "bg-primary-light text-primary-dark",
  update: "bg-stone-100 text-stone-700",
  delete: "bg-warning-light text-warning",
};

// Owner only: who changed what, and when, newest first. RLS on audit_log
// also allows only the owner, so this check is for a friendly 404.
export default async function AuditLogPage({ searchParams }: PageProps<"/more/audit">) {
  await connection();
  const supabase = await createClient();
  const { userId, me } = await getSession(supabase);
  if (!userId) redirect("/login");
  if (!me) return <NotStaff />;
  if (me.role !== "owner") notFound();

  const params = await searchParams;
  const person = first(params.person);
  const area = first(params.area);
  const from = first(params.from);
  const to = first(params.to);
  const page = Math.max(1, Number.parseInt(first(params.page), 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  // One extra row tells us whether there's an older page.
  let query = supabase
    .from("audit_log")
    .select("id, at, actor_id, actor_role, table_name, row_id, action, old_data, new_data, changed_fields")
    .order("at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + PAGE_SIZE);
  if (person === "system") query = query.is("actor_id", null);
  else if (UUID_RE.test(person)) query = query.eq("actor_id", person);
  if (isKnownTable(area)) query = query.eq("table_name", area);
  if (isYmd(from)) query = query.gte("at", exportBounds(from, from).start);
  if (isYmd(to)) query = query.lt("at", exportBounds(to, to).end);

  const [logResult, staffResult, sitesResult, templatesResult, unitsResult] = await Promise.all([
    query,
    supabase.from("staff").select("id, name").order("name"),
    supabase.from("sites").select("id, name"),
    supabase.from("record_templates").select("code, title"),
    supabase.from("temp_units").select("id, name"),
  ]);
  const rows = (logResult.data ?? []) as AuditEntry[];
  const entries = rows.slice(0, PAGE_SIZE);
  const hasOlder = rows.length > PAGE_SIZE;
  const staff = (staffResult.data ?? []) as { id: string; name: string }[];

  // Record entries only know their sheet; look up those sheets' templates.
  const sheetIds = [
    ...new Set(
      entries
        .filter((e) => e.table_name === "record_entries")
        .map((e) => (e.new_data ?? e.old_data)?.sheet_id)
        .filter((id): id is string => typeof id === "string"),
    ),
  ];
  // Notice reads only know their notice; look up those titles.
  const noticeIds = [
    ...new Set(
      entries
        .filter((e) => e.table_name === "notice_reads")
        .map((e) => (e.new_data ?? e.old_data)?.notice_id)
        .filter((id): id is string => typeof id === "string"),
    ),
  ];
  const [sheetsResult, noticesResult] = await Promise.all([
    sheetIds.length
      ? supabase.from("record_sheets").select("id, template_code").in("id", sheetIds)
      : { data: [] as { id: string; template_code: string }[] },
    noticeIds.length
      ? supabase.from("notices").select("id, title").in("id", noticeIds)
      : { data: [] as { id: string; title: string }[] },
  ]);

  const lookups: AuditLookups = {
    staff: byId(staff),
    sites: byId(sitesResult.data as { id: string; name: string }[] | null),
    templates: Object.fromEntries(
      ((templatesResult.data ?? []) as { code: string; title: string }[]).map((t) => [t.code, t.title]),
    ),
    sheets: Object.fromEntries((sheetsResult.data ?? []).map((s) => [s.id, s.template_code])),
    units: byId(unitsResult.data as { id: string; name: string }[] | null),
    notices: Object.fromEntries(((noticesResult.data ?? []) as { id: string; title: string }[]).map((n) => [n.id, n.title])),
  };

  const pageHref = (n: number) => {
    const q = new URLSearchParams();
    if (person) q.set("person", person);
    if (area) q.set("area", area);
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    if (n > 1) q.set("page", String(n));
    const text = q.toString();
    return text ? `/more/audit?${text}` : "/more/audit";
  };

  return (
    <main className="mx-auto w-full max-w-md px-4 pt-2 pb-6">
      <BackLink />
      <h1 className="text-3xl font-bold">Audit log</h1>
      <p className="mt-1 text-sm text-muted">Every change, newest first. Only you can see this.</p>

      <form method="get" className="mt-4 grid grid-cols-2 gap-2 rounded-[14px] border border-line bg-white p-3">
        <div className="col-span-2">
          <label htmlFor="audit-person" className="text-[13px] font-semibold text-muted">
            Person
          </label>
          <select id="audit-person" name="person" defaultValue={person} className={inputClass}>
            <option value="">Everyone</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            <option value="system">System</option>
          </select>
        </div>
        <div className="col-span-2">
          <label htmlFor="audit-area" className="text-[13px] font-semibold text-muted">
            Area
          </label>
          <select id="audit-area" name="area" defaultValue={area} className={inputClass}>
            <option value="">Everything</option>
            {areaOptions().map(([table, label]) => (
              <option key={table} value={table}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="audit-from" className="text-[13px] font-semibold text-muted">
            From
          </label>
          <input id="audit-from" name="from" type="date" defaultValue={from} max={aucklandDate()} className={inputClass} />
        </div>
        <div>
          <label htmlFor="audit-to" className="text-[13px] font-semibold text-muted">
            To
          </label>
          <input id="audit-to" name="to" type="date" defaultValue={to} max={aucklandDate()} className={inputClass} />
        </div>
        <button
          type="submit"
          className="col-span-2 min-h-12 rounded-xl bg-primary px-5 font-semibold text-white hover:bg-primary-dark"
        >
          Show
        </button>
      </form>

      {logResult.error ? (
        <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-red-800">
          Could not load the audit log: {logResult.error.message}
        </p>
      ) : entries.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-line bg-white p-4 text-muted">
          {page > 1 ? "No more changes." : "No changes match."}
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-line rounded-[14px] border border-line bg-white">
          {entries.map((e) => {
            const changes = changeList(e, lookups);
            return (
              <li key={e.id} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-[15px] font-semibold text-ink">{describeAudit(e, lookups)}</p>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${actionClass[e.action] ?? ""}`}>
                    {e.action === "insert" ? "Added" : e.action === "update" ? "Changed" : "Deleted"}
                  </span>
                </div>
                <p className="text-sm text-muted">
                  {formatAuditValue("at", e.at)} · {actorName(e, lookups)}
                  {e.actor_id && e.actor_role ? ` (${e.actor_role})` : ""} · {areaLabel(e.table_name)}
                </p>
                {changes.length > 0 && (
                  <dl className="mt-2 space-y-1 rounded-xl bg-cream p-2.5 text-sm">
                    {changes.map((c) => (
                      <div key={c.column}>
                        <dt className="font-semibold text-ink">{c.label}</dt>
                        <dd className="break-words text-muted">
                          <span className="line-through decoration-muted/60">{c.before}</span>
                          <span aria-hidden="true"> → </span>
                          <span className="sr-only"> changed to </span>
                          <span className="text-ink">{c.after}</span>
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {(page > 1 || hasOlder) && (
        <nav aria-label="Pages" className="mt-4 grid grid-cols-2 gap-2">
          {page > 1 ? (
            <Link
              href={pageHref(page - 1)}
              className="flex min-h-12 items-center justify-center rounded-xl border border-line bg-white font-semibold text-ink hover:border-muted"
            >
              Newer
            </Link>
          ) : (
            <span />
          )}
          {hasOlder ? (
            <Link
              href={pageHref(page + 1)}
              className="flex min-h-12 items-center justify-center rounded-xl border border-line bg-white font-semibold text-ink hover:border-muted"
            >
              Older
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
      <p className="mt-2 text-center text-xs text-muted">Page {page}</p>
    </main>
  );
}
