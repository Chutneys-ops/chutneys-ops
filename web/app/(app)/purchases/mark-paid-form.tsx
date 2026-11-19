"use client";

// "Mark paid back" for one own-money purchase (managers and the owner).

import { useActionState } from "react";
import type { PaidBackState } from "./actions";

const initialState: PaidBackState = { seq: 0 };

export function MarkPaidForm({ action }: { action: (prev: PaidBackState) => Promise<PaidBackState> }) {
  const [state, formAction, pending] = useActionState(action, initialState);
  return (
    <form action={formAction} className="mt-2">
      <button
        type="submit"
        disabled={pending}
        className="min-h-12 w-full rounded-xl border border-primary/40 bg-white px-4 font-semibold text-primary-dark hover:border-primary disabled:cursor-wait disabled:opacity-70"
      >
        {pending ? "Saving…" : "Mark paid back"}
      </button>
      {state.message && !state.ok && (
        <p role="alert" className="mt-1 text-sm text-warning">
          {state.message}
        </p>
      )}
    </form>
  );
}
