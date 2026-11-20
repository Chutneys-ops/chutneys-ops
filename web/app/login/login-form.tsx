"use client";

import Link from "next/link";
import { useActionState } from "react";
import { LogoMark } from "@/components/logo-mark";
import { login, type LoginState } from "./actions";

const initialState: LoginState = { error: null };

/** notice: a message from the page's ?notice= (for example "your account
 *  has been turned off"), shown until the person tries to sign in. */
export function LoginForm({ notice }: { notice: string | null }) {
  // state = whatever login() last returned; pending = true while it runs.
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <form
      action={formAction}
      className="flex w-full max-w-sm flex-col gap-5 rounded-2xl border border-line bg-white p-6"
    >
      <div className="flex items-center gap-3">
        <LogoMark size="lg" />
        <div className="flex flex-col">
          <h1 className="text-2xl font-bold">Chutneys Ops</h1>
          <p className="text-sm text-muted">Sign in with your work email.</p>
        </div>
      </div>

      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Email
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          className="min-h-12 rounded-xl border border-muted bg-white px-3 text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Password
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="min-h-12 rounded-xl border border-muted bg-white px-3 text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
        />
      </label>

      {notice && !state.error && (
        <p role="status" className="rounded-xl bg-warning-light p-3 text-sm font-medium text-warning">
          {notice}
        </p>
      )}

      {state.error && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="min-h-12 rounded-xl bg-primary px-4 font-semibold text-white hover:bg-primary-dark disabled:opacity-70"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>

      <Link
        href="/forgot-password"
        className="-mt-2 min-h-12 content-center text-center text-sm font-medium text-primary hover:text-primary-dark"
      >
        Forgot password?
      </Link>
    </form>
  );
}
