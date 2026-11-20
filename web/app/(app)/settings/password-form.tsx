"use client";

import { useActionState } from "react";
import { FormMessage, PasswordField } from "@/components/password-field";
import { MIN_PASSWORD_LENGTH } from "@/lib/passwords";
import { changePassword, type ChangePasswordState } from "./password-actions";

const initialState: ChangePasswordState = { seq: 0 };

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState(changePassword, initialState);
  return (
    <>
      {/* key: empties the boxes after each attempt. The message sits outside
          the keyed form, so it stays on screen. */}
      <form key={state.seq} action={formAction} className="space-y-4">
        <PasswordField label="Current password" name="current" autoComplete="current-password" />
        <PasswordField
          label="New password"
          name="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          hint={`At least ${MIN_PASSWORD_LENGTH} characters, and not your email address.`}
        />
        <button
          type="submit"
          disabled={pending}
          className="min-h-[50px] w-full rounded-xl bg-primary px-4 text-base font-semibold text-white hover:bg-primary-dark disabled:cursor-wait disabled:opacity-70"
        >
          {pending ? "Changing…" : "Change password"}
        </button>
      </form>
      <div className="mt-4 empty:hidden">
        <FormMessage ok={state.ok} message={state.message} />
      </div>
    </>
  );
}
