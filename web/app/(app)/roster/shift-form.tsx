"use client";

// The roster shift form: person, day, start, finish, position and note. A
// live preview shows the NZ breaks and paid hours (lib/breaks.ts); the
// database works them out again and that's what counts.

import { useActionState, useState } from "react";
import { MAX_SHIFT_MINUTES, breakSummary, minutesBetween } from "@/lib/breaks";
import { shortYmd } from "@/lib/leave";
import { POSITION_SUGGESTIONS } from "@/lib/roster";
import type { ShiftFormState } from "./actions";

const initialState: ShiftFormState = { seq: 0 };
const inputClass =
  "mt-1.5 min-h-12 w-full rounded-xl border bg-white px-3 text-base text-ink focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none";

export type ShiftDefaults = {
  staff_id: string;
  work_date: string;
  start_time: string;
  finish_time: string;
  position: string;
  note: string;
};

type Props = {
  action: (prev: ShiftFormState, formData: FormData) => Promise<ShiftFormState>;
  /** Unique per form on the page, for input ids. */
  idPrefix: string;
  people: { id: string; name: string }[];
  /** The 7 dates of the week. */
  days: string[];
  defaults: ShiftDefaults;
  submitLabel: string;
};

export function ShiftForm(props: Props) {
  const [state, formAction, pending] = useActionState(props.action, initialState);
  // key: after a save the form remounts with the defaults; after an error,
  // with what was typed.
  return <FormBody key={state.seq} {...props} state={state} formAction={formAction} pending={pending} />;
}

function FormBody({
  idPrefix,
  people,
  days,
  defaults,
  submitLabel,
  state,
  formAction,
  pending,
}: Props & { state: ShiftFormState; formAction: (formData: FormData) => void; pending: boolean }) {
  const typed = state.ok ? undefined : state.values;
  const [start, setStart] = useState(typed?.start_time ?? defaults.start_time);
  const [finish, setFinish] = useState(typed?.finish_time ?? defaults.finish_time);
  const errors = state.ok ? {} : (state.errors ?? {});

  const minutes = minutesBetween(start, finish);
  let preview = "Enter a start and finish time to see breaks and paid hours.";
  if (start && finish && minutes === null) preview = "The finish time must be different from the start time.";
  else if (minutes !== null && minutes > MAX_SHIFT_MINUTES) preview = "That's more than 16 hours.";
  else if (minutes !== null) preview = breakSummary(minutes);
  const pastMidnight = minutes !== null && finish < start;

  const id = (name: string) => `${idPrefix}-${name}`;
  const field = (name: string) => ({
    id: id(name),
    name,
    "aria-invalid": Boolean(errors[name]),
    "aria-describedby": errors[name] ? id(`${name}-error`) : undefined,
    className: `${inputClass} ${errors[name] ? "border-warning" : "border-line"}`,
  });
  const fieldError = (name: string) =>
    errors[name] ? (
      <p id={id(`${name}-error`)} className="mt-1 text-sm text-warning">
        {errors[name]}
      </p>
    ) : null;

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor={id("staff_id")} className="block text-sm font-semibold text-ink">
            Person
          </label>
          <select {...field("staff_id")} defaultValue={typed?.staff_id ?? defaults.staff_id}>
            <option value="">Choose…</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {fieldError("staff_id")}
        </div>
        <div>
          <label htmlFor={id("work_date")} className="block text-sm font-semibold text-ink">
            Day
          </label>
          <select {...field("work_date")} defaultValue={typed?.work_date ?? defaults.work_date}>
            {days.map((d) => (
              <option key={d} value={d}>
                {shortYmd(d)}
              </option>
            ))}
          </select>
          {fieldError("work_date")}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor={id("start_time")} className="block text-sm font-semibold text-ink">
            Start
          </label>
          <input {...field("start_time")} type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          {fieldError("start_time")}
        </div>
        <div>
          <label htmlFor={id("finish_time")} className="block text-sm font-semibold text-ink">
            Finish
          </label>
          <input {...field("finish_time")} type="time" value={finish} onChange={(e) => setFinish(e.target.value)} />
          {fieldError("finish_time")}
        </div>
      </div>

      <p className="rounded-xl bg-cream p-3 text-sm text-ink" aria-live="polite">
        {preview}
        {pastMidnight && <span className="block text-muted">Finishes the next morning.</span>}
      </p>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor={id("position")} className="block text-sm font-semibold text-ink">
            Position <span className="font-normal text-muted">(optional)</span>
          </label>
          <input
            {...field("position")}
            type="text"
            maxLength={40}
            autoComplete="off"
            list={id("positions")}
            defaultValue={typed?.position ?? defaults.position}
          />
          <datalist id={id("positions")}>
            {POSITION_SUGGESTIONS.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
          {fieldError("position")}
        </div>
        <div>
          <label htmlFor={id("note")} className="block text-sm font-semibold text-ink">
            Note <span className="font-normal text-muted">(optional)</span>
          </label>
          <input {...field("note")} type="text" maxLength={200} autoComplete="off" defaultValue={typed?.note ?? defaults.note} />
          {fieldError("note")}
        </div>
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
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
