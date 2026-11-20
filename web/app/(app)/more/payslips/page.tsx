import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { BackLink } from "@/components/back-link";
import { NotStaff } from "@/components/not-staff";
import { aucklandDate, aucklandShortDay, aucklandTime } from "@/lib/dates";
import {
  defaultRun,
  groupRuns,
  payslipState,
  runLabel,
  runSummary,
  STATE_LABELS,
  type PayslipRow,
  type PayslipState,
} from "@/lib/payslips";
import { loadPayrollCodes } from "@/lib/supabase/payroll-codes";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/supabase/session";
import { PublishDrafts, WithdrawPayslip } from "./run-controls";
import { UploadPayRun } from "./upload-pay-run";

type Row = PayslipRow & { withdrawn_reason: string | null; source: string };

/** How many recent payslips to load for the run list (about 10 runs of 30 people). */
const RECENT_LIMIT = 300;

const stateClass: Record<PayslipState, string> = {
  draft: "bg-stone-100 text-stone-700",
  published: "bg-warning-light text-warning",
  viewed: "bg-primary-light text-primary-dark",
  withdrawn: "bg-stone-100 text-stone-500 line-through",
};

// Owner only. The database also allows only the owner to see everyone's
// payslips, upload, publish and withdraw, so this check is for a friendly 404.
export default async function PayslipsAdminPage() {
  await connection();
  const supabase = await createClient();
  const { userId, me } = await getSession(supabase);
  if (!userId) redirect("/login");
  if (!me) return <NotStaff />;
  if (me.role !== "owner") notFound();

  const [staffResult, codeResult, payslipResult] = await Promise.all([
    supabase.from("staff").select("id, name, active").order("name"),
    loadPayrollCodes(supabase),
    supabase
      .from("payslips")
      .select("id, staff_id, pay_date, period_start, period_end, published_at, viewed_at, withdrawn_at, withdrawn_reason, source")
      .order("pay_date", { ascending: false })
      .limit(RECENT_LIMIT),
  ]);
  // Payroll codes are private: they come from staff_payroll_codes().
  const staff = ((staffResult.data ?? []) as { id: string; name: string; active: boolean }[]).map((s) => ({
    ...s,
    payroll_code: codeResult.codes.get(s.id) ?? null,
  }));
  const byId = new Map(staff.map((s) => [s.id, s]));
  const nameOf = (id: string) => byId.get(id)?.name ?? "Someone";
  const runs = groupRuns((payslipResult.data ?? []) as Row[], nameOf);
  const error = staffResult.error ?? codeResult.error ?? payslipResult.error;
  const withoutCode = staff.filter((s) => s.active && !s.payroll_code).length;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pt-2 pb-6">
      <BackLink />
      <h1 className="text-3xl font-bold">Payslips</h1>
      <p className="mt-1 text-sm text-muted">
        Upload a pay run&apos;s PDFs, check who each is for, then publish. Each person sees only their own, in More &gt;
        My payslips.
      </p>

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-warning-light px-3 py-2 text-sm font-medium text-warning">
          Could not load payslips: {error.message}
        </p>
      )}

      <section className="mt-5 rounded-[14px] border border-line bg-white p-4">
        <h2 className="text-lg font-semibold">Upload pay run</h2>
        <p className="mt-1 mb-4 text-sm text-muted">
          Files are matched by the payroll code or name in the file name, then by the text inside the PDF.
          {withoutCode > 0 && (
            <>
              {" "}
              {withoutCode} {withoutCode === 1 ? "person has" : "people have"} no payroll code yet; add codes in{" "}
              <Link href="/more/staff" className="font-semibold text-primary underline">
                Staff
              </Link>{" "}
              for surer matches.
            </>
          )}
        </p>
        {/* Leavers too: the owner can upload their final payslip. */}
        <UploadPayRun
          people={staff}
          initialRun={defaultRun(aucklandDate())}
        />
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-[13px] font-semibold tracking-wide text-muted uppercase">Pay runs</h2>
        {runs.length === 0 && <p className="text-sm text-muted">No payslips uploaded yet.</p>}
        <ul className="space-y-3">
          {runs.map((run, index) => {
            const draftIds = run.rows.filter((r) => payslipState(r) === "draft").map((r) => r.id);
            return (
              <li key={run.key} className="rounded-[14px] border border-line bg-white">
                <details open={index === 0} className="group">
                  <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-semibold text-ink">{runLabel(run)}</span>
                      <span className="block text-sm text-muted">{runSummary(run)}</span>
                    </span>
                    <svg aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-muted transition-transform group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </summary>
                  <div className="border-t border-line px-4 py-3">
                    {draftIds.length > 0 && (
                      <div className="mb-3">
                        <PublishDrafts ids={draftIds} />
                      </div>
                    )}
                    <ul className="divide-y divide-line">
                      {run.rows.map((row) => {
                        const state = payslipState(row);
                        const turnedOff = byId.get(row.staff_id)?.active === false;
                        return (
                          <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                            <span className="min-w-0 flex-1">
                              <span className="block font-semibold text-ink">{nameOf(row.staff_id)}</span>
                              <span className="block text-sm text-muted">
                                {state === "viewed" && row.viewed_at
                                  ? `Opened ${aucklandShortDay(row.viewed_at)}, ${aucklandTime(row.viewed_at)}`
                                  : state === "withdrawn"
                                    ? `Withdrawn: ${row.withdrawn_reason ?? ""}`
                                    : STATE_LABELS[state]}
                              </span>
                              {turnedOff && state !== "withdrawn" && (
                                <span className="block text-sm text-warning">
                                  Account turned off: they can&apos;t sign in. Download it and send it to them.
                                </span>
                              )}
                            </span>
                            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${stateClass[state]}`}>
                              {STATE_LABELS[state]}
                            </span>
                            <a
                              href={`/payslips/${row.id}/file`}
                              target="_blank"
                              rel="noopener"
                              className="inline-flex min-h-11 items-center rounded-xl border border-line px-3 text-sm font-semibold text-ink hover:border-muted"
                            >
                              Open
                            </a>
                            <a
                              href={`/payslips/${row.id}/file?download=1`}
                              className="inline-flex min-h-11 items-center rounded-xl border border-line px-3 text-sm font-semibold text-ink hover:border-muted"
                            >
                              Download
                            </a>
                            {state !== "withdrawn" && <WithdrawPayslip id={row.id} name={nameOf(row.staff_id)} />}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
        {(payslipResult.data?.length ?? 0) >= RECENT_LIMIT && (
          <p className="mt-3 text-sm text-muted">Showing the most recent {RECENT_LIMIT} payslips.</p>
        )}
      </section>
    </main>
  );
}
