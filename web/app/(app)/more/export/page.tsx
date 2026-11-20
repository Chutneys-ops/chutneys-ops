import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { BackLink } from "@/components/back-link";
import { NotStaff } from "@/components/not-staff";
import { aucklandDate } from "@/lib/dates";
import { MAX_EXPORT_DAYS } from "@/lib/hours-export";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/supabase/session";

const inputClass =
  "mt-1.5 min-h-12 w-full rounded-xl border border-line bg-white px-3 text-base text-ink focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none";

// Owner only: pick a date range, download shifts and approved leave as a
// CSV for payroll. The CSV route checks the role again on the server.
export default async function ExportHoursPage() {
  await connection();
  const supabase = await createClient();
  const { userId, me } = await getSession(supabase);
  if (!userId) redirect("/login");
  if (!me) return <NotStaff />;
  if (me.role !== "owner") notFound();

  const today = aucklandDate();
  const monthStart = `${today.slice(0, 7)}-01`;

  return (
    <main className="mx-auto w-full max-w-md px-4 pt-2 pb-6">
      <BackLink />
      <h1 className="text-3xl font-bold">Export hours and leave</h1>
      <p className="mt-1 text-sm text-muted">
        One row per timesheet (at work, rest and meal breaks, paid hours, status) or approved leave request. Up to{" "}
        {MAX_EXPORT_DAYS} days at a time.
      </p>

      {/* A plain GET form: the browser downloads the CSV the route returns. */}
      <form method="get" action="/more/export/csv" className="mt-4 space-y-4 rounded-[14px] border border-line bg-white p-4">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="export-from" className="block text-sm font-semibold text-ink">
              From
            </label>
            <input id="export-from" name="from" type="date" required defaultValue={monthStart} max={today} className={inputClass} />
          </div>
          <div>
            <label htmlFor="export-to" className="block text-sm font-semibold text-ink">
              To
            </label>
            <input id="export-to" name="to" type="date" required defaultValue={today} className={inputClass} />
          </div>
        </div>
        <button
          type="submit"
          className="min-h-[50px] w-full rounded-xl bg-primary px-4 text-base font-semibold text-white hover:bg-primary-dark"
        >
          Download CSV
        </button>
      </form>
    </main>
  );
}
