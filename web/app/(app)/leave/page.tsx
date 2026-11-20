import { redirect } from "next/navigation";
import { connection } from "next/server";
import { BackLink } from "@/components/back-link";
import { NotStaff } from "@/components/not-staff";
import { aucklandDate } from "@/lib/dates";
import {
  LEAVE_REASON_LABELS,
  LEAVE_STATUS_LABELS,
  dateRangeText,
  hoursText,
  type LeaveReason,
  type LeaveStatus,
} from "@/lib/leave";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/supabase/session";
import { LeaveForm } from "./leave-form";
import { statusClass } from "./status";

type MyRequest = {
  id: string;
  reason: LeaveReason;
  start_date: string;
  end_date: string;
  hours: number | string;
  status: LeaveStatus;
  gi_symptoms: boolean;
  cleared_to_work_at: string | null;
  decision_note: string | null;
  certificate_path: string | null;
};

// Your sick leave: the request form and your requests with their status.
export default async function LeavePage() {
  await connection();
  const supabase = await createClient();
  const { userId, me } = await getSession(supabase);
  if (!userId) redirect("/login");
  if (!me) return <NotStaff />;

  const [requestsResult, clearanceResult] = await Promise.all([
    supabase
      .from("leave_requests")
      .select(
        "id, reason, start_date, end_date, hours, status, gi_symptoms, cleared_to_work_at, decision_note, certificate_path",
      )
      .eq("staff_id", userId)
      .order("start_date", { ascending: false })
      .limit(50),
    supabase.rpc("needs_clearance"),
  ]);
  const requests = (requestsResult.data ?? []) as MyRequest[];
  const needsClearance = clearanceResult.data === true;

  return (
    <main className="mx-auto w-full max-w-md px-4 pt-2 pb-6">
      <BackLink />
      <h1 className="text-3xl font-bold">Leave</h1>

      {needsClearance && (
        <p role="alert" className="mt-4 rounded-[14px] border border-warning/40 bg-warning-light p-4 text-[15px] text-ink">
          <span className="font-semibold text-warning">You can&apos;t clock in yet.</span> You reported vomiting or
          diarrhoea, so a manager needs to clear you to return to work (usually 48 hours after it stops).
        </p>
      )}

      <section className="mt-4 rounded-[14px] border border-line bg-white p-4">
        <h2 className="mb-3 text-lg font-semibold">Request sick leave</h2>
        <LeaveForm userId={userId} today={aucklandDate()} />
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Your requests</h2>
        {requestsResult.error ? (
          <p role="alert" className="mt-3 rounded-xl bg-red-50 p-4 text-red-800">
            Could not load your requests: {requestsResult.error.message}
          </p>
        ) : requests.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-line bg-white p-4 text-muted">No requests yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line rounded-[14px] border border-line bg-white">
            {requests.map((r) => (
              <li key={r.id} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-[15px] font-semibold text-ink">{dateRangeText(r.start_date, r.end_date)}</p>
                  <p className="shrink-0 text-[15px] font-semibold text-ink">{hoursText(r.hours)}</p>
                </div>
                <p className="text-sm text-muted">
                  {LEAVE_REASON_LABELS[r.reason]}
                  {r.gi_symptoms ? " · vomiting or diarrhoea" : ""}
                </p>
                <p className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${statusClass[r.status]}`}>
                  {LEAVE_STATUS_LABELS[r.status]}
                </p>
                {r.gi_symptoms && (
                  <p className="mt-1 text-sm text-ink">
                    {r.cleared_to_work_at
                      ? `Cleared to return on ${aucklandDate(new Date(r.cleared_to_work_at))}`
                      : "Not cleared to return yet"}
                  </p>
                )}
                {r.decision_note && <p className="mt-1 text-sm text-ink">Manager: {r.decision_note}</p>}
                {r.certificate_path && (
                  <a
                    href={`/leave/certificate/${r.id}`}
                    target="_blank"
                    rel="noopener"
                    className="mt-1 inline-flex min-h-12 items-center text-sm font-semibold text-primary hover:text-primary-dark"
                  >
                    View certificate
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
