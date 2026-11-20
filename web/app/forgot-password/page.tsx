"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormMessage } from "@/components/password-field";
import { LogoMark } from "@/components/logo-mark";
import { requestReset, type ForgotState } from "./actions";

const initialState: ForgotState = { sent: false, error: null };

// The same words whether or not the email has an account.
const SENT_MESSAGE = "If that email has an account, we've sent a link. Check your inbox (and spam).";

export default function ForgotPasswordPage() {
  const [state, formAction, pending] = useActionState(requestReset, initialState);

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <form
        action={formAction}
        className="flex w-full max-w-sm flex-col gap-5 rounded-2xl border border-line bg-white p-6"
      >
        <div className="flex items-center gap-3">
          <LogoMark size="lg" />
          <div className="flex flex-col">
            <h1 className="text-2xl font-bold">Forgot password</h1>
            <p className="text-sm text-muted">We&apos;ll email you a link to choose a new one.</p>
          </div>
        </div>

        {state.sent ? (
          <FormMessage ok message={SENT_MESSAGE} />
        ) : (
          <>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Work email
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                className="min-h-12 rounded-xl border border-muted bg-white px-3 text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
              />
            </label>
            <FormMessage message={state.error ?? undefined} />
            <button
              type="submit"
              disabled={pending}
              className="min-h-12 rounded-xl bg-primary px-4 font-semibold text-white hover:bg-primary-dark disabled:opacity-70"
            >
              {pending ? "Sending…" : "Email me a link"}
            </button>
          </>
        )}

        <Link href="/login" className="min-h-12 content-center text-center text-sm font-medium text-primary hover:text-primary-dark">
          Back to sign in
        </Link>
      </form>
    </main>
  );
}
