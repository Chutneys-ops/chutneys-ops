"use client";

import { useActionState } from "react";
import { FormMessage, PasswordField } from "@/components/password-field";
import { MIN_PASSWORD_LENGTH } from "@/lib/passwords";
import { setPassword, type SetPasswordState } from "./actions";

const initialState: SetPasswordState = { error: null };

export function SetPasswordForm({ email }: { email: string | null }) {
  const [state, formAction, pending] = useActionState(setPassword, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {email && (
        <p className="text-sm text-muted">
          For <span className="font-semibold text-ink">{email}</span>
        </p>
      )}
      {/* Lets password managers save the new password against the right email. */}
      {email && <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />}
      <PasswordField
        label="New password"
        name="password"
        autoComplete="new-password"
        minLength={MIN_PASSWORD_LENGTH}
        hint={`At least ${MIN_PASSWORD_LENGTH} characters, and not your email address.`}
      />
      <PasswordField
        label="Type it again"
        name="confirm"
        autoComplete="new-password"
        minLength={MIN_PASSWORD_LENGTH}
      />
      <FormMessage message={state.error ?? undefined} />
      <button
        type="submit"
        disabled={pending}
        className="min-h-12 rounded-xl bg-primary px-4 font-semibold text-white hover:bg-primary-dark disabled:opacity-70"
      >
        {pending ? "Saving…" : "Save password"}
      </button>
    </form>
  );
}
