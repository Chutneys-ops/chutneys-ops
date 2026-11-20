"use client";

import { useId, useState } from "react";

// A password box with a Show/Hide button, so people on a phone can check
// what they typed. Used on /set-password and Settings > Change password.

export const passwordInputClass =
  "min-h-12 w-full rounded-xl border border-muted bg-white py-2 pr-20 pl-3 text-base text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/30";

type Props = {
  label: string;
  name: string;
  autoComplete: "new-password" | "current-password";
  hint?: string;
  minLength?: number;
};

export function PasswordField({ label, name, autoComplete, hint, minLength }: Props) {
  const [shown, setShown] = useState(false);
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-ink">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="mt-0.5 text-sm text-muted">
          {hint}
        </p>
      )}
      <div className="relative mt-1.5">
        <input
          id={id}
          name={name}
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          minLength={minLength}
          required
          aria-describedby={hint ? hintId : undefined}
          className={passwordInputClass}
        />
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          aria-pressed={shown}
          aria-controls={id}
          className="absolute inset-y-1 right-1 min-w-16 rounded-lg px-3 text-sm font-semibold text-primary hover:bg-primary-light focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
        >
          {shown ? "Hide" : "Show"}
        </button>
      </div>
    </div>
  );
}

/** Green "saved" or amber "problem" message under a form. */
export function FormMessage({ ok, message }: { ok?: boolean; message?: string }) {
  if (!message) return null;
  return (
    <p
      role={ok ? "status" : "alert"}
      className={
        ok
          ? "rounded-xl bg-primary-light px-3 py-2 text-sm font-medium text-primary-dark"
          : "rounded-xl bg-warning-light px-3 py-2 text-sm font-medium text-warning"
      }
    >
      {message}
    </p>
  );
}
