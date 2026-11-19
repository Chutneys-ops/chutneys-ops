"use client";

// "Verify and sign" for managers and owners. The PIN goes to the
// sign_off_sheet database function, which checks it against the stored hash.

import { useActionState } from "react";
import { initialFormState, type FormState } from "./form-state";

export function SignOffForm({
  action,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [state, formAction, pending] = useActionState(action, initialFormState);
  const error = state.ok ? null : state.message;

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
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "sign-off-error" : undefined}
          className={`mt-1.5 min-h-12 w-40 rounded-xl border bg-white px-3 text-center text-xl tracking-[0.5em] text-ink focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none ${
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
        disabled={pending}
        className="min-h-[50px] w-full rounded-xl bg-primary-dark px-4 text-base font-semibold text-white hover:bg-ink disabled:cursor-wait disabled:opacity-70"
      >
        {pending ? "Checking…" : "Verify and sign"}
      </button>
    </form>
  );
}
