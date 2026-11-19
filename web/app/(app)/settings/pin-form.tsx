"use client";

import { useActionState } from "react";
import { setPin, type PinState } from "./actions";

const initialState: PinState = { seq: 0 };

const inputClass =
  "mt-1.5 min-h-12 w-40 rounded-xl border border-line bg-white px-3 text-center text-xl tracking-[0.5em] text-ink focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none";

export function PinForm() {
  const [state, formAction, pending] = useActionState(setPin, initialState);
  return (
    // key: empties both boxes after each attempt.
    <form key={state.seq} action={formAction} className="space-y-4">
      <div>
        <label htmlFor="pin" className="block text-sm font-semibold text-ink">
          New PIN (4 digits)
        </label>
        <input
          id="pin"
          name="pin"
          type="password"
          inputMode="numeric"
          pattern="[0-9]{4}"
          maxLength={4}
          autoComplete="new-password"
          required
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor="confirm" className="block text-sm font-semibold text-ink">
          Type it again
        </label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          inputMode="numeric"
          pattern="[0-9]{4}"
          maxLength={4}
          autoComplete="new-password"
          required
          className={inputClass}
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
        className="min-h-[50px] w-full rounded-xl bg-primary px-4 text-base font-semibold text-white hover:bg-primary-dark disabled:cursor-wait disabled:opacity-70"
      >
        {pending ? "Saving…" : "Save PIN"}
      </button>
    </form>
  );
}
