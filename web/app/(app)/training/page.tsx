import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { BackLink } from "@/components/back-link";
import { NotStaff } from "@/components/not-staff";
import { aucklandDate, aucklandShortDay } from "@/lib/dates";
import { shortYmd } from "@/lib/leave";
import { createClient } from "@/lib/supabase/server";
import { getSession, isManager } from "@/lib/supabase/session";
import { TOPIC_LABELS, type TrainingTopic } from "@/lib/training";
import { recordTraining } from "./actions";
import { ConfirmTraining } from "./confirm-training";
import { RecordTrainingForm } from "./record-training-form";

type TrainingRow = {
  id: string;
  topic: TrainingTopic;
  topic_detail: string | null;
  trainee_id: string;
  trained_on: string;
  trainee_signed_at: string | null;
  trainee_signature_path: string | null;
  notes: string | null;
  trainee: { name: string } | null;
  trainer: { name: string } | null;
};

// training_records links to staff twice (trainee, trainer), so each join
// names the one it means.
const SELECT =
  "id, topic, topic_detail, trainee_id, trained_on, trainee_signed_at, trainee_signature_path, notes, " +
  "trainee:staff!training_records_trainee_id_fkey(name), trainer:staff!training_records_trainer_id_fkey(name)";

function topicText(r: TrainingRow): string {
  return r.topic_detail ? `${TOPIC_LABELS[r.topic]}: ${r.topic_detail}` : TOPIC_LABELS[r.topic];
}

function Status({ r }: { r: TrainingRow }) {
  if (!r.trainee_signed_at) {
    return <p className="mt-1 inline-block rounded-full bg-warning-light px-2 py-0.5 text-xs font-semibold text-warning">Not confirmed yet</p>;
  }
  return (
    <p className="mt-1 text-sm text-muted">
      <span className="inline-block rounded-full bg-primary-light px-2 py-0.5 text-xs font-semibold text-primary-dark">
        Confirmed {aucklandShortDay(r.trainee_signed_at)}
      </span>
      {r.trainee_signature_path && (
        <a
          href={`/training/signature/${r.id}`}
          target="_blank"
          rel="noopener"
          className="ml-2 inline-flex min-h-12 items-center font-semibold text-primary hover:text-primary-dark"
        >
          Signature
        </a>
      )}
    </p>
  );
}

// Training: your records (confirm the ones waiting). Managers and the owner
// also record training they gave and see everyone's latest records.
export default async function TrainingPage() {
  await connection();
  const supabase = await createClient();
  const { userId, me } = await getSession(supabase);
  if (!userId) redirect("/login");
  if (!me) return <NotStaff />;
  const manager = isManager(me);

  const [mineResult, allResult, staffResult] = await Promise.all([
    supabase.from("training_records").select(SELECT).eq("trainee_id", userId).order("trained_on", { ascending: false }),
    manager
      ? supabase.from("training_records").select(SELECT).order("trainer_signed_at", { ascending: false }).limit(30)
      : Promise.resolve({ data: [], error: null }),
    manager
      ? supabase.from("staff").select("id, name").neq("id", userId).order("name")
      : Promise.resolve({ data: [], error: null }),
  ]);
  const error = mineResult.error ?? allResult.error ?? staffResult.error;
  const mine = (mineResult.data ?? []) as unknown as TrainingRow[];
  const recent = (allResult.data ?? []) as unknown as TrainingRow[];
  const staff = (staffResult.data ?? []) as { id: string; name: string }[];
  const toConfirm = mine.filter((r) => !r.trainee_signed_at);

  return (
    <main className="mx-auto w-full max-w-md px-4 pt-2 pb-6">
      <BackLink />
      <h1 className="text-3xl font-bold">Training</h1>

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-red-800">
          Could not load training: {error.message}
        </p>
      )}

      {toConfirm.length > 0 && (
        <section className="mt-4 rounded-[14px] border border-warning/40 bg-warning-light p-4">
          <h2 className="text-lg font-semibold text-warning">Training to confirm</h2>
          <p className="mt-1 text-sm text-ink">Confirm you received this training. Adding a signature is optional.</p>
          <ul className="mt-3 space-y-3">
            {toConfirm.map((r) => (
              <li key={r.id} className="rounded-xl border border-line bg-white p-3.5">
                <p className="text-[15px] font-semibold text-ink">{topicText(r)}</p>
                <p className="text-sm text-muted">
                  {shortYmd(r.trained_on)} · trained by {r.trainer?.name ?? "a manager"}
                </p>
                {r.notes && <p className="mt-1 text-sm text-ink">{r.notes}</p>}
                <ConfirmTraining recordId={r.id} userId={userId} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {manager && (
        <section className="mt-4 rounded-[14px] border border-line bg-white p-4">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">Record training</h2>
            <Link href="/training/matrix" className="inline-flex min-h-12 items-center text-sm font-semibold text-primary hover:text-primary-dark">
              Matrix
            </Link>
          </div>
          <RecordTrainingForm action={recordTraining} staff={staff} today={aucklandDate()} />
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Your training</h2>
        {mine.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-line bg-white p-4 text-muted">No training recorded yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line rounded-[14px] border border-line bg-white">
            {mine.map((r) => (
              <li key={r.id} className="px-4 py-3">
                <p className="text-[15px] font-semibold text-ink">{topicText(r)}</p>
                <p className="text-sm text-muted">
                  {shortYmd(r.trained_on)} · trained by {r.trainer?.name ?? "a manager"}
                </p>
                <Status r={r} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {manager && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold">Recently recorded</h2>
          {recent.length === 0 ? (
            <p className="mt-3 rounded-xl border border-dashed border-line bg-white p-4 text-muted">Nothing recorded yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line rounded-[14px] border border-line bg-white">
              {recent.map((r) => (
                <li key={r.id} className="px-4 py-3">
                  <p className="text-[15px] font-semibold text-ink">{r.trainee?.name ?? "Unknown"}</p>
                  <p className="text-sm text-muted">
                    {topicText(r)} · {shortYmd(r.trained_on)} · by {r.trainer?.name ?? "Unknown"}
                  </p>
                  <Status r={r} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
