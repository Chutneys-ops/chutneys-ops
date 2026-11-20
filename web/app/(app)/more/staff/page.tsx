import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { BackLink } from "@/components/back-link";
import { NotStaff } from "@/components/not-staff";
import { aucklandShortDay } from "@/lib/dates";
import { ROLE_LABELS, sortByStatusThenName, STATUS_LABELS, staffStatus, type Role, type StaffStatus } from "@/lib/staff";
import { loadPayrollCodes } from "@/lib/supabase/payroll-codes";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/supabase/session";
import { InviteForm, PayrollCodeForm, ResetTwoStepForm, StaffActions } from "./staff-forms";

type StaffRow = {
  id: string;
  name: string;
  email: string | null;
  role: Role;
  active: boolean;
  invited_at: string | null;
  deactivated_at: string | null;
  payroll_code: string | null;
};
type Login = { staff_id: string; joined: boolean; last_sign_in_at: string | null };
type MfaCount = { staff_id: string; factors: number };

/** "Two-step: 2 devices", "Two-step: not set up". */
function twoStepLabel(factors: number): string {
  if (factors === 0) return "Two-step: not set up";
  return `Two-step: ${factors} ${factors === 1 ? "device" : "devices"}`;
}

const statusClass: Record<StaffStatus, string> = {
  active: "bg-primary-light text-primary-dark",
  invited: "bg-stone-100 text-stone-700",
  deactivated: "bg-warning-light text-warning",
};

// Owner only: everyone with a login, their role and whether they've joined.
// The database also allows only the owner (staff_logins, set_staff_role,
// set_staff_active), so this check is for a friendly 404.
export default async function StaffPage() {
  await connection();
  const supabase = await createClient();
  const { userId, me } = await getSession(supabase);
  if (!userId) redirect("/login");
  if (!me) return <NotStaff />;
  if (me.role !== "owner") notFound();

  // Payroll codes are private (only the owner and the person can read
  // them), so they come from staff_payroll_codes(), not the staff table.
  const [staffResult, loginsResult, codeResult, mfaResult] = await Promise.all([
    supabase.from("staff").select("id, name, email, role, active, invited_at, deactivated_at").order("name"),
    supabase.rpc("staff_logins"),
    loadPayrollCodes(supabase),
    supabase.rpc("staff_mfa_factors"),
  ]);
  const mfaFactors = new Map(((mfaResult.data ?? []) as MfaCount[]).map((m) => [m.staff_id, m.factors]));
  const joined = new Map(((loginsResult.data ?? []) as Login[]).map((l) => [l.staff_id, l.joined]));
  const people = sortByStatusThenName(
    ((staffResult.data ?? []) as Omit<StaffRow, "payroll_code">[]).map((row) => ({
      ...row,
      payroll_code: codeResult.codes.get(row.id) ?? null,
      status: staffStatus(row.active, joined.get(row.id) ?? false),
    })),
  );
  const error = staffResult.error ?? loginsResult.error ?? codeResult.error ?? mfaResult.error;

  return (
    <main className="mx-auto w-full max-w-md px-4 pt-2 pb-6">
      <BackLink />
      <h1 className="text-3xl font-bold">Staff</h1>
      <p className="mt-1 text-sm text-muted">
        Invite people, change what they can do, and turn off accounts for leavers.
      </p>

      <section className="mt-5 rounded-[14px] border border-line bg-white p-4">
        <h2 className="text-lg font-semibold">Invite staff</h2>
        <p className="mt-1 mb-4 text-sm text-muted">
          They get an email with a link to choose their password. Nobody can sign up without an invite.
        </p>
        <InviteForm />
      </section>

      <section className="mt-5">
        <h2 className="mb-2 text-[13px] font-semibold tracking-wide text-muted uppercase">
          Everyone ({people.length})
        </h2>
        {error && (
          <p role="alert" className="mb-3 rounded-xl bg-warning-light px-3 py-2 text-sm font-medium text-warning">
            Could not load everyone: {error.message}
          </p>
        )}
        <ul className="space-y-3">
          {people.map((person) => {
            const isMe = person.id === me.id;
            return (
              <li key={person.id} className="rounded-[14px] border border-line bg-white p-4">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-base font-semibold text-ink">{person.name}</span>
                  {isMe && <span className="text-sm text-muted">(you)</span>}
                </div>
                {person.email && <p className="text-sm break-all text-muted">{person.email}</p>}
                <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold">
                  <span className="rounded-full border border-line px-2.5 py-1 text-ink">{ROLE_LABELS[person.role]}</span>
                  <span className={`rounded-full px-2.5 py-1 ${statusClass[person.status]}`}>
                    {STATUS_LABELS[person.status]}
                  </span>
                  {person.payroll_code && (
                    <span className="rounded-full border border-line px-2.5 py-1 text-muted">Payroll {person.payroll_code}</span>
                  )}
                  {person.status !== "deactivated" && (
                    <span
                      className={`rounded-full px-2.5 py-1 ${
                        (mfaFactors.get(person.id) ?? 0) === 0 && person.role !== "staff"
                          ? "bg-warning-light text-warning"
                          : "border border-line text-muted"
                      }`}
                    >
                      {twoStepLabel(mfaFactors.get(person.id) ?? 0)}
                    </span>
                  )}
                </div>
                {person.status === "invited" && person.invited_at && (
                  <p className="mt-2 text-sm text-muted">Invite sent {aucklandShortDay(person.invited_at)}</p>
                )}
                {person.status === "deactivated" && person.deactivated_at && (
                  <p className="mt-2 text-sm text-muted">Turned off {aucklandShortDay(person.deactivated_at)}</p>
                )}

                {isMe ? (
                  <div className="mt-3 space-y-4">
                    <p className="text-sm text-muted">
                      You can&apos;t change your own role or turn off your own account, so there is always an owner.
                    </p>
                    <PayrollCodeForm person={{ id: person.id, payrollCode: person.payroll_code }} />
                  </div>
                ) : (
                  <details className="group mt-3">
                    <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between rounded-xl border border-line px-3 font-semibold text-ink hover:border-muted">
                      Manage
                      <svg aria-hidden="true" className="h-[18px] w-[18px] text-muted transition-transform group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </summary>
                    <div className="mt-4 space-y-5">
                      {person.status !== "deactivated" && (
                        <PayrollCodeForm person={{ id: person.id, payrollCode: person.payroll_code }} />
                      )}
                      <StaffActions person={{ id: person.id, name: person.name, role: person.role, status: person.status }} />
                      {person.status === "active" && (mfaFactors.get(person.id) ?? 0) > 0 && (
                        <ResetTwoStepForm person={{ id: person.id, name: person.name }} />
                      )}
                    </div>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
