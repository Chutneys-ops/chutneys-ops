"use client";

// Clock-out time (Auckland) and a required note for one forgotten shift.

import { useActionState } from "react";
import type { FixState } from "./actions";

const initialState: FixState = { seq: 0 };

const inputClass =
  "mt-1.5 min-h-12 w-full rounded-xl border border-line bg-white px-3 text-base text-ink focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none";

export function FixShiftForm({
  action,
  shiftId,
  defaultClockOut,
  min,
  max,
}: {
  action: (prev: FixState, formData: FormData) => Promise<FixState>;
  shiftId: string;
  /** Auckland "YYYY-MM-DDTHH:mm" values for <input type="datetime-local">. */
  defaultClockOut: string;
  min: string;
  max: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const id = (name: string) => `fix-${shiftId}-${name}`;

  return (
    <form action={formAction} className="mt-3 space-y-3">
      <div>
        <label htmlFor={id("time")} className="block text-sm font-semibold text-ink">
          Clock-out time (Auckland)
        </label>
        <input
          id={id("time")}
          name="clock_out"
          type="datetime-local"
          required
          defaultValue={defaultClockOut}
          min={min}
          max={max}
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor={id("note")} className="block text-sm font-semibold text-ink">
          Note (required)
        </label>
        <textarea
          id={id("note")}
          name="note"
          required
          rows={2}
          maxLength={500}
          placeholder="e.g. Left at 6 pm after close, confirmed with them"
          className={`${inputClass} py-2`}
        />
      </div>
      {state.message && (
        <p
          role={state.ok ? "status" : "alert"}
          className={
            state.ok
              ? "rounded-xl bg-primary-light px-3 py-2 text-sm font-medium text-primary-dark"
              : "rounded-xl bg-warning-light px-3 py-2 text-sm font-medium text-warning"
          }
        >
          {state.message}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="min-h-12 w-full rounded-xl bg-primary px-4 font-semibold text-white hover:bg-primary-dark disabled:cursor-wait disabled:opacity-70"
      >
        {pending ? "Saving…" : "Save clock-out"}
      </button>
    </form>
  );
}
