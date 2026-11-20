"use client";

// Sign out. Trucks share tablets, so it also:
//   - stops this device getting your notifications (the next person on it
//     would otherwise get yours);
//   - clears what the browser kept for you (components/shared-device.tsx);
//   - loads /login as a full page, so none of your pages stay in memory.
// Never holds up signing out for long: if the browser is slow to answer, it
// signs out anyway.

import { useTransition } from "react";
import { signOutEverywhereHere } from "@/components/shared-device";

export function SignOutButton() {
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      onClick={() => start(() => signOutEverywhereHere())}
      disabled={pending}
      className="mt-5 min-h-12 w-full rounded-xl border border-line bg-white px-4 font-semibold text-ink hover:border-muted disabled:cursor-wait disabled:opacity-70"
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
