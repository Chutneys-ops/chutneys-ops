import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { BackLink } from "@/components/back-link";
import { NotStaff } from "@/components/not-staff";
import { aucklandShortDay } from "@/lib/dates";
import {
  LEAVE_REASON_LABELS,
  LEAVE_STATUS_LABELS,
  dateRangeText,
  hoursText,
  type LeaveReason,
  type LeaveStatus,
} from "@/lib/leave";
import { createClient } from "@/lib/supabase/server";
import { getSession, isManager } from "@/lib/supabase/session";
import { decideLeave } from "../actions";
import { DecideForm } from "../manager-forms";
import { statusClass } from "../status";

type RequestRow = {
  id: string;
  staff_id: string;
  reason: LeaveReason;
  start_date: string;
  end_date: string;
  hours: number | string;
  note: string | null;
  certificate_path: string | null;
  gi_symptoms: boolean;
  status: LeaveStatus;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
  person: { name: string } | null;
  decider: { name: string } | null;
};

// leave_requests links to staff three times (staff_id, decided_by,
// cleared_by), so each join names the one it means.
const SELECT =
  "id, staff_id, reason, start_date, end_date, hours, note, certificate_path, gi_symptoms, status, decided_at, " +
  "decision_note, created_at, person:staff!leave_requests_staff_id_fkey(name), " +
  "decider:staff!leave_requests_decided_by_fkey(name)";

function Summary({ r }: { r: RequestRow }) {
  return (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[15px] font-semibold text-ink">{r.person?.name ?? "Unknown"}</p>
        <p className="shrink-0 text-[15px] font-semibold text-ink">{hoursText(r.hours)}</p>
      </div>
      <p className="text-sm text-muted">
        {dateRangeText(r.start_date, r.end_date)} · {LEAVE_REASON_LABELS[r.reason]}
      </p>
      {r.gi_symptoms && (
        <p className="mt-1 text-sm font-semibold text-warning">Vomiting or diarrhoea: see Staff sickness</p>
      )}
      {r.note && <p className="mt-1 text-sm text-ink">&ldquo;{r.note}&rdquo;</p>}
      {r.certificate_path && (
        <a
          href={`/leave/certificate/${r.id}`}
          target="_blank"
          rel="noopener"
          className="inline-flex min-h-12 items-center text-sm font-semibold text-primary hover:text-primary-dark"
        >
          View certificate
        </a>
      )}
    </>
  );
}

// Managers and owner: pending sick leave to approve or decline, and the
// latest decisions.
export default async function LeaveRequestsPage() {
  await connection();
  const supabase = await createClient();
  const { userId, me } = await getSession(supabase);
  if (!userId) redirect("/login");
  if (!me) return <NotStaff />;
  if (!isManager(me)) notFound();

  const [pendingResult, decidedResult] = await Promise.all([
    supabase.from("leave_requests").select(SELECT).eq("status", "pending").order("created_at"),
    supabase
      .from("leave_requests")
      .select(SELECT)
      .neq("status", "pending")
      .order("decided_at", { ascending: false })
      .limit(20),
  ]);
  const error = pendingResult.error ?? decidedResult.error;
  const pending = (pendingResult.data ?? []) as unknown as RequestRow[];
  const decided = (decidedResult.data ?? []) as unknown as RequestRow[];

  return (
    <main className="mx-auto w-full max-w-md px-4 pt-2 pb-6">
      <BackLink />
      <h1 className="text-3xl font-bold">Leave requests</h1>

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-red-800">
          Could not load leave requests: {error.message}
        </p>
      )}

      <section className="mt-4">
        <h2 className="text-lg font-semibold">Waiting for a decision</h2>
        {pending.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-line bg-white p-4 text-muted">Nothing waiting.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {pending.map((r) => {
              // decide_leave refuses your own unless you're the owner.
              const canDecide = r.staff_id !== me.id || me.role === "owner";
              return (
                <li key={r.id} className="rounded-[14px] border border-line bg-white p-4">
                  <Summary r={r} />
                  <p className="text-xs text-muted">Asked {aucklandShortDay(r.created_at)}</p>
                  {canDecide ? (
                    <DecideForm action={decideLeave.bind(null, r.id)} id={r.id} hours={Number(r.hours).toFixed(2)} />
                  ) : (
                    <p className="mt-2 text-sm text-muted">Your own request: another manager or the owner decides it.</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Recently decided</h2>
        {decided.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-line bg-white p-4 text-muted">No decisions yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line rounded-[14px] border border-line bg-white">
            {decided.map((r) => (
              <li key={r.id} className="px-4 py-3">
                <Summary r={r} />
                <p className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${statusClass[r.status]}`}>
                  {LEAVE_STATUS_LABELS[r.status]}
                  {r.decider ? ` by ${r.decider.name}` : ""}
                  {r.decided_at ? `, ${aucklandShortDay(r.decided_at)}` : ""}
                </p>
                {r.decision_note && <p className="mt-1 text-sm text-ink">Note: {r.decision_note}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
