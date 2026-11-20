"use client";

// Sign out, and stop this device getting your notifications first. Trucks
// share tablets: without this, the next person on it would still get the
// last person's notifications. Never holds up signing out for long: if the
// browser is slow to answer, it signs out anyway.

import { useTransition } from "react";
import { logout } from "@/app/login/actions";
import { removeSubscription } from "@/app/(app)/settings/notification-actions";

async function forgetThisDevice(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration("/");
  const sub = await registration?.pushManager?.getSubscription();
  if (!sub) return;
  await removeSubscription(sub.endpoint);
  await sub.unsubscribe();
}

export function SignOutButton() {
  const [pending, start] = useTransition();

  function signOut() {
    start(async () => {
      const giveUp = new Promise<void>((resolve) => setTimeout(resolve, 2000));
      await Promise.race([forgetThisDevice().catch(() => undefined), giveUp]);
      await logout();
    });
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={pending}
      className="mt-5 min-h-12 w-full rounded-xl border border-line bg-white px-4 font-semibold text-ink hover:border-muted disabled:cursor-wait disabled:opacity-70"
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
