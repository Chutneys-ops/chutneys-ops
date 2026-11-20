"use client";

// One-button forms on /time: "Approve all" for a group and "Delete" for
// hours that haven't been approved yet.

import { useActionState } from "react";
import type { ActionResult } from "./actions";

const initialState: ActionResult = { seq: 0 };

export function ActionButton({
  action,
  label,
  pendingLabel,
  tone = "primary",
}: {
  action: (prev: ActionResult) => Promise<ActionResult>;
  label: string;
  pendingLabel: string;
  tone?: "primary" | "plain";
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  return (
    <form action={formAction} className="mt-3">
      <button
        type="submit"
        disabled={pending}
        className={`min-h-12 w-full rounded-xl px-4 font-semibold disabled:cursor-wait disabled:opacity-70 ${
          tone === "primary"
            ? "bg-primary text-white hover:bg-primary-dark"
            : "border border-line bg-white text-ink hover:border-muted"
        }`}
      >
        {pending ? pendingLabel : label}
      </button>
      {state.message && (
        <p
          role={state.ok ? "status" : "alert"}
          className={`mt-1 text-sm font-medium ${state.ok ? "text-primary-dark" : "text-warning"}`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
