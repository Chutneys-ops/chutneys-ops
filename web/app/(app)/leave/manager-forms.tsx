"use client";

// Manager forms for one leave request: approve or decline, and clear to
// return to work after vomiting or diarrhoea.

import { useActionState } from "react";
import { CLEARANCE_REMINDER } from "@/lib/leave";
import type { DecisionState } from "./actions";

const initialState: DecisionState = { seq: 0 };
const inputClass =
  "mt-1.5 min-h-12 w-full rounded-xl border border-line bg-white px-3 text-base text-ink focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none";

type Action = (prev: DecisionState, formData: FormData) => Promise<DecisionState>;

export function DecideForm({ action, id, hours }: { action: Action; id: string; hours: string }) {
  const [state, formAction, pending] = useActionState(action, initialState);
  return (
    <form action={formAction} className="mt-3 space-y-3">
      <div>
        <label htmlFor={`hours-${id}`} className="block text-sm font-semibold text-ink">
          Hours to approve
        </label>
        <input
          id={`hours-${id}`}
          name="hours"
          type="text"
          inputMode="decimal"
          defaultValue={hours}
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor={`note-${id}`} className="block text-sm font-semibold text-ink">
          Note <span className="font-normal text-muted">(needed to decline)</span>
        </label>
        <input id={`note-${id}`} name="note" type="text" maxLength={300} autoComplete="off" className={inputClass} />
      </div>
      {state.message && (
        <p
          role={state.ok ? "status" : "alert"}
          className={`text-sm font-medium ${state.ok ? "text-primary-dark" : "text-warning"}`}
        >
          {state.message}
        </p>
      )}
      {/* The button pressed is sent as "status". */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="submit"
          name="status"
          value="declined"
          disabled={pending}
          className="min-h-12 rounded-xl border border-line bg-white px-4 font-semibold text-ink hover:border-muted disabled:cursor-wait disabled:opacity-70"
        >
          Decline
        </button>
        <button
          type="submit"
          name="status"
          value="approved"
          disabled={pending}
          className="min-h-12 rounded-xl bg-primary px-4 font-semibold text-white hover:bg-primary-dark disabled:cursor-wait disabled:opacity-70"
        >
          {pending ? "Saving…" : "Approve"}
        </button>
      </div>
    </form>
  );
}

export function ClearForm({ action, id }: { action: Action; id: string }) {
  const [state, formAction, pending] = useActionState(action, initialState);
  return (
    <form action={formAction} className="mt-3 space-y-3">
      <p className="rounded-xl bg-warning-light p-3 text-sm text-ink">{CLEARANCE_REMINDER}</p>
      <label htmlFor={`confirm-${id}`} className="flex min-h-12 cursor-pointer items-center gap-3 text-sm text-ink">
        <input id={`confirm-${id}`} name="confirm_48h" type="checkbox" required className="h-5 w-5 shrink-0 accent-primary" />
        They have been free of symptoms for at least 48 hours
      </label>
      {state.message && !state.ok && (
        <p role="alert" className="text-sm font-medium text-warning">
          {state.message}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="min-h-12 w-full rounded-xl bg-primary px-4 font-semibold text-white hover:bg-primary-dark disabled:cursor-wait disabled:opacity-70"
      >
        {pending ? "Saving…" : "Clear to return"}
      </button>
    </form>
  );
}
