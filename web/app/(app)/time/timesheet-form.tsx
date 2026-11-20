"use client";

// The hours form: date, site, start, finish (and a person and note when a
// manager adds hours for someone). A live preview shows the NZ breaks and
// paid hours as you type, from lib/breaks.ts. The database works them out
// again and that's what counts.

import { useActionState, useState } from "react";
import { MAX_SHIFT_MINUTES, breakSummary, minutesBetween } from "@/lib/breaks";
import type { TimesheetFormState } from "./actions";

const initialState: TimesheetFormState = { seq: 0 };
const inputClass =
  "mt-1.5 min-h-12 w-full rounded-xl border bg-white px-3 text-base text-ink focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none";

export type TimesheetDefaults = {
  work_date: string;
  site_id: string;
  start_time: string;
  finish_time: string;
};

type Props = {
  action: (prev: TimesheetFormState, formData: FormData) => Promise<TimesheetFormState>;
  /** Unique per form on the page, for input ids. */
  idPrefix: string;
  sites: { id: string; name: string }[];
  today: string;
  defaults: TimesheetDefaults;
  /** Managers adding hours for someone: who can be picked. */
  people?: { id: string; name: string }[];
  /** A note is required (someone else's hours, or approved hours). */
  noteRequired?: boolean;
  submitLabel: string;
};

export function TimesheetForm(props: Props) {
  const [state, formAction, pending] = useActionState(props.action, initialState);
  // key: after a save the form remounts with the defaults; after an error,
  // with what was typed.
  return <FormBody key={state.seq} {...props} state={state} formAction={formAction} pending={pending} />;
}

function FormBody({
  idPrefix,
  sites,
  today,
  defaults,
  people,
  noteRequired = false,
  submitLabel,
  state,
  formAction,
  pending,
}: Props & { state: TimesheetFormState; formAction: (formData: FormData) => void; pending: boolean }) {
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
      {people && (
        <div>
          <label htmlFor={id("staff_id")} className="block text-sm font-semibold text-ink">
            Whose hours?
          </label>
          <select {...field("staff_id")} defaultValue={typed?.staff_id ?? ""}>
            <option value="">Choose a person…</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {fieldError("staff_id")}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor={id("work_date")} className="block text-sm font-semibold text-ink">
            Date
          </label>
          <input {...field("work_date")} type="date" max={today} defaultValue={typed?.work_date ?? defaults.work_date} />
          {fieldError("work_date")}
        </div>
        <div>
          <label htmlFor={id("site_id")} className="block text-sm font-semibold text-ink">
            Site
          </label>
          <select {...field("site_id")} defaultValue={typed?.site_id ?? defaults.site_id}>
            <option value="">Choose…</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {fieldError("site_id")}
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

      {(noteRequired || people) && (
        <div>
          <label htmlFor={id("edit_note")} className="block text-sm font-semibold text-ink">
            Note <span className="font-normal text-muted">(required: what and why)</span>
          </label>
          <input {...field("edit_note")} type="text" maxLength={300} autoComplete="off" defaultValue={typed?.edit_note ?? ""} />
          {fieldError("edit_note")}
        </div>
      )}

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
