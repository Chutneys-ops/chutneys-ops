import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { BackLink } from "@/components/back-link";
import { NotStaff } from "@/components/not-staff";
import { createClient } from "@/lib/supabase/server";
import { getSession, isManager } from "@/lib/supabase/session";
import {
  TOPIC_LABELS,
  TOPIC_SHORT,
  TRAINING_TOPICS,
  buildTrainingMatrix,
  matrixDate,
  type MatrixRecord,
} from "@/lib/training";

// Managers and owner: staff down the side, topics across, the latest
// training date in each cell. The table scrolls sideways inside its card,
// so the page itself never scrolls sideways on a phone.
export default async function TrainingMatrixPage() {
  await connection();
  const supabase = await createClient();
  const { userId, me } = await getSession(supabase);
  if (!userId) redirect("/login");
  if (!me) return <NotStaff />;
  if (!isManager(me)) notFound();

  const [staffResult, recordsResult] = await Promise.all([
    supabase.from("staff").select("id, name").order("name"),
    supabase.from("training_records").select("trainee_id, topic, trained_on, trainee_signed_at"),
  ]);
  const error = staffResult.error ?? recordsResult.error;
  const rows = buildTrainingMatrix(
    (staffResult.data ?? []) as { id: string; name: string }[],
    (recordsResult.data ?? []) as MatrixRecord[],
  );

  return (
    <main className="mx-auto w-full max-w-md px-4 pt-2 pb-6 md:max-w-4xl">
      <BackLink href="/training" label="Training" />
      <h1 className="text-3xl font-bold">Training matrix</h1>
      <p className="mt-1 text-sm text-muted">
        Latest date for each topic (day/month/year). <span className="font-semibold text-warning">*</span> not confirmed
        by the trainee yet.
      </p>

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-red-800">
          Could not load the matrix: {error.message}
        </p>
      )}

      <div className="mt-4 overflow-x-auto rounded-[14px] border border-line bg-white">
        <table className="text-left text-sm">
          <caption className="sr-only">Training matrix: staff by topic, latest training date</caption>
          <thead className="border-b border-line text-muted">
            <tr>
              <th scope="col" className="sticky left-0 z-10 bg-white px-3 py-2 font-semibold">
                Name
              </th>
              {TRAINING_TOPICS.map((topic) => (
                <th key={topic} scope="col" title={TOPIC_LABELS[topic]} className="px-3 py-2 font-semibold whitespace-nowrap">
                  {TOPIC_SHORT[topic]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr key={row.id}>
                <th scope="row" className="sticky left-0 z-10 bg-white px-3 py-2 font-semibold whitespace-nowrap text-ink">
                  {row.name}
                </th>
                {TRAINING_TOPICS.map((topic) => {
                  const cell = row.cells[topic];
                  return (
                    <td key={topic} className="px-3 py-2 whitespace-nowrap tabular-nums">
                      {cell ? (
                        <span className={cell.confirmed ? "text-ink" : "text-warning"}>
                          {matrixDate(cell.date)}
                          {!cell.confirmed && (
                            <>
                              <span aria-hidden="true">*</span>
                              <span className="sr-only"> (not confirmed)</span>
                            </>
                          )}
                        </span>
                      ) : (
                        <span className="sr-only">Not trained</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
