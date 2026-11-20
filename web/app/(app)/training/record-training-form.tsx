"use client";

// "Record training" (managers and owner): who, what, when, notes. You are
// the trainer, and your login is your signature.

import { useActionState } from "react";
import { TOPIC_LABELS, TRAINING_TOPICS } from "@/lib/training";
import type { TrainingFormState } from "./actions";

const initialState: TrainingFormState = { seq: 0 };
const inputClass =
  "mt-1.5 min-h-12 w-full rounded-xl border bg-white px-3 text-base text-ink focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none";

export function RecordTrainingForm({
  action,
  staff,
  today,
}: {
  action: (prev: TrainingFormState, formData: FormData) => Promise<TrainingFormState>;
  staff: { id: string; name: string }[];
  today: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const errors = state.ok ? {} : (state.errors ?? {});
  // After a save the form remounts empty; after an error, with what was typed.
  const typed = state.ok ? {} : (state.values ?? {});

  const field = (name: string) => ({
    id: `training-${name}`,
    name,
    defaultValue: typed[name] ?? "",
    "aria-invalid": Boolean(errors[name]),
    "aria-describedby": errors[name] ? `training-${name}-error` : undefined,
    className: `${inputClass} ${errors[name] ? "border-warning" : "border-line"}`,
  });
  const fieldError = (name: string) =>
    errors[name] ? (
      <p id={`training-${name}-error`} className="mt-1 text-sm text-warning">
        {errors[name]}
      </p>
    ) : null;

  return (
    <form key={state.seq} action={formAction} className="space-y-4">
      <div>
        <label htmlFor="training-trainee_id" className="block text-sm font-semibold text-ink">
          Who did you train?
        </label>
        <select {...field("trainee_id")}>
          <option value="">Choose a person…</option>
          {staff.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
        {fieldError("trainee_id")}
      </div>

      <div>
        <label htmlFor="training-topic" className="block text-sm font-semibold text-ink">
          Topic
        </label>
        <select {...field("topic")}>
          <option value="">Choose a topic…</option>
          {TRAINING_TOPICS.map((topic) => (
            <option key={topic} value={topic}>
              {TOPIC_LABELS[topic]}
            </option>
          ))}
        </select>
        {fieldError("topic")}
      </div>

      <div>
        <label htmlFor="training-topic_detail" className="block text-sm font-semibold text-ink">
          Detail <span className="font-normal text-muted">(needed for &ldquo;Other&rdquo;)</span>
        </label>
        <input {...field("topic_detail")} type="text" maxLength={200} autoComplete="off" />
        {fieldError("topic_detail")}
      </div>

      <div>
        <label htmlFor="training-trained_on" className="block text-sm font-semibold text-ink">
          Date
        </label>
        <input {...field("trained_on")} defaultValue={typed.trained_on ?? today} type="date" max={today} />
        {fieldError("trained_on")}
      </div>

      <div>
        <label htmlFor="training-notes" className="block text-sm font-semibold text-ink">
          Notes <span className="font-normal text-muted">(optional)</span>
        </label>
        <textarea {...field("notes")} rows={2} maxLength={500} />
        {fieldError("notes")}
      </div>

      {state.message && (
        <p
          role={state.ok ? "status" : "alert"}
          className={`rounded-xl p-3 text-sm font-medium ${
            state.ok ? "bg-primary-light text-primary-dark" : "bg-warning-light text-warning"
          }`}
        >
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="min-h-[50px] w-full rounded-xl bg-primary px-4 text-base font-semibold text-white hover:bg-primary-dark disabled:cursor-wait disabled:opacity-70"
      >
        {pending ? "Saving…" : "Record and sign as trainer"}
      </button>
    </form>
  );
}
