"use client";

// "Verify and sign" for managers and owners. The PIN goes to the
// sign_off_sheet database function, which checks it against the stored hash.
//
// After too many wrong PINs the action returns `lockedUntil`. The button is
// then disabled and shows the minutes left, ticking down until the lock ends.

import { useActionState, useEffect, useState } from "react";
import { initialFormState, type FormState } from "./form-state";

export function SignOffForm({
  action,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [state, formAction, pending] = useActionState(action, initialFormState);
  const minutesLeft = useMinutesLeft(state.lockedUntil, state.lockedMinutes);
  const locked = minutesLeft > 0;
  // Once the lock has run out, the "locked" message is out of date: hide it.
  const lockExpired = Boolean(state.lockedUntil) && !locked;
  const error = state.ok || lockExpired ? null : state.message;

  let buttonText = "Verify and sign";
  if (pending) buttonText = "Checking…";
  else if (locked) buttonText = `Locked: try again in ${minutesLeft} ${minutesLeft === 1 ? "minute" : "minutes"}`;

  return (
    // key: clears the PIN box after every attempt.
    <form key={state.seq} action={formAction} className="space-y-3">
      <div>
        <label htmlFor="sign-off-pin" className="block text-sm font-semibold text-ink">
          Your 4-digit PIN
        </label>
        <input
          id="sign-off-pin"
          name="pin"
          type="password"
          inputMode="numeric"
          pattern="[0-9]{4}"
          maxLength={4}
          autoComplete="off"
          required
          disabled={locked}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "sign-off-error" : undefined}
          className={`mt-1.5 min-h-12 w-40 rounded-xl border bg-white px-3 text-center text-xl tracking-[0.5em] text-ink focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none disabled:opacity-60 ${
            error ? "border-warning" : "border-line"
          }`}
        />
      </div>
      {error && (
        <p id="sign-off-error" role="alert" className="text-sm font-medium text-warning">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending || locked}
        className={`min-h-[50px] w-full rounded-xl bg-primary-dark px-4 text-base font-semibold text-white hover:bg-ink disabled:opacity-70 ${
          locked ? "disabled:cursor-not-allowed" : "disabled:cursor-wait"
        }`}
      >
        {buttonText}
      </button>
    </form>
  );
}

/**
 * Whole minutes until `until` (rounded up, like the database), or 0 when
 * there's no lock or it has ended. Re-checks every 10 seconds.
 */
function useMinutesLeft(until: string | undefined, startMinutes: number | undefined): number {
  // Each tick remembers which lock it was for, so a new lock never uses an
  // old lock's clock. Before the first tick, use the server's minutes
  // (Date.now() can't be called while rendering).
  const [tick, setTick] = useState<{ until: string; now: number } | null>(null);

  useEffect(() => {
    if (!until) return;
    const end = Date.parse(until);
    const timer = setInterval(() => {
      const now = Date.now();
      setTick({ until, now });
      if (now >= end) clearInterval(timer);
    }, 10_000);
    return () => clearInterval(timer);
  }, [until]);

  if (!until) return 0;
  if (tick?.until !== until) return startMinutes ?? 0;
  return Math.max(0, Math.ceil((Date.parse(until) - tick.now) / 60_000));
}
