import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { BackLink } from "@/components/back-link";
import { NotStaff } from "@/components/not-staff";
import { aucklandShortDay, aucklandTime } from "@/lib/dates";
import { dateRangeText } from "@/lib/leave";
import { createClient } from "@/lib/supabase/server";
import { getSession, isManager } from "@/lib/supabase/session";
import { clearToWork } from "../actions";
import { ClearForm } from "../manager-forms";

type SicknessRow = {
  id: string;
  staff_id: string;
  start_date: string;
  end_date: string;
  created_at: string;
  cleared_to_work_at: string | null;
  person: { name: string } | null;
  clearer: { name: string } | null;
};

// Managers and owner: the MPI staff sickness record. Everyone who reported
// vomiting or diarrhoea: name, date sick, date cleared, cleared by. People
// not cleared yet are at the top with "Clear to return".
export default async function StaffSicknessPage() {
  await connection();
  const supabase = await createClient();
  const { userId, me } = await getSession(supabase);
  if (!userId) redirect("/login");
  if (!me) return <NotStaff />;
  if (!isManager(me)) notFound();

  const { data, error } = await supabase
    .from("leave_requests")
    .select(
      "id, staff_id, start_date, end_date, created_at, cleared_to_work_at, " +
        "person:staff!leave_requests_staff_id_fkey(name), clearer:staff!leave_requests_cleared_by_fkey(name)",
    )
    .eq("gi_symptoms", true)
    .order("start_date", { ascending: false })
    .limit(200);
  const rows = (data ?? []) as unknown as SicknessRow[];
  const waiting = rows.filter((r) => !r.cleared_to_work_at);
  const cleared = rows.filter((r) => r.cleared_to_work_at);

  return (
    <main className="mx-auto w-full max-w-md px-4 pt-2 pb-6">
      <BackLink />
      <h1 className="text-3xl font-bold">Staff sickness</h1>
      <p className="mt-1 text-sm text-muted">
        Food safety record of staff with vomiting or diarrhoea. They can&apos;t choose a site or add hours for later days until cleared.
      </p>

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-red-800">
          Could not load the sickness record: {error.message}
        </p>
      )}

      <section className="mt-4">
        <h2 className="text-lg font-semibold">Not cleared yet</h2>
        {waiting.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-line bg-white p-4 text-muted">Nobody is waiting.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {waiting.map((r) => {
              // clear_to_work refuses your own unless you're the owner.
              const canClear = r.staff_id !== me.id || me.role === "owner";
              return (
                <li key={r.id} className="rounded-[14px] border border-warning/40 bg-white p-4">
                  <p className="text-[15px] font-semibold text-ink">{r.person?.name ?? "Unknown"}</p>
                  <p className="text-sm text-muted">
                    Sick {dateRangeText(r.start_date, r.end_date)} · reported {aucklandShortDay(r.created_at)}
                  </p>
                  {canClear ? (
                    <ClearForm action={clearToWork.bind(null, r.id)} id={r.id} />
                  ) : (
                    <p className="mt-2 text-sm text-muted">You can&apos;t clear yourself: another manager or the owner does.</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Record</h2>
        {cleared.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-line bg-white p-4 text-muted">Nothing recorded yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-[14px] border border-line bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-muted">
                <tr>
                  <th scope="col" className="px-3 py-2 font-semibold">Name</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Sick</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Cleared</th>
                  <th scope="col" className="px-3 py-2 font-semibold">By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {cleared.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2 font-semibold text-ink">{r.person?.name ?? "Unknown"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{dateRangeText(r.start_date, r.end_date)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {r.cleared_to_work_at &&
                        `${aucklandShortDay(r.cleared_to_work_at)}, ${aucklandTime(r.cleared_to_work_at)}`}
                    </td>
                    <td className="px-3 py-2">{r.clearer?.name ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
