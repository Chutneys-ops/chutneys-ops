"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

const initialState: LoginState = { error: null };

export default function LoginPage() {
  // state = whatever login() last returned; pending = true while it runs.
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <form
        action={formAction}
        className="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
      >
        <h1 className="text-2xl font-semibold">Chutneys Ops</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Sign in with your work email.
        </p>

        <label className="flex flex-col gap-1 text-sm font-medium">
          Email
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            className="rounded-md border border-zinc-300 px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium">
          Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="rounded-md border border-zinc-300 px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>

        {state.error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-zinc-900 px-4 py-2.5 font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
