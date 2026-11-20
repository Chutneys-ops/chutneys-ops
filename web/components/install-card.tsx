"use client";

// A small "Install the app" card for Home. Hidden when the app is already
// installed (running standalone), before the browser has hydrated, and once
// dismissed on this device.

import Link from "next/link";
import { dismissInstallCard, useInstallCardDismissed, usePlatform } from "./install-status";

export function InstallCard() {
  const platform = usePlatform();
  const dismissed = useInstallCardDismissed();
  if (dismissed || platform === "unknown" || platform === "standalone") return null;

  return (
    <section className="mt-4 flex items-center gap-3 rounded-[14px] border border-primary/30 bg-primary-light p-3 pl-4">
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold text-primary-dark">Install the app</p>
        <p className="text-sm text-ink">Open Chutneys Ops from your home screen, full screen.</p>
      </div>
      <Link
        href="/install"
        className="inline-flex min-h-12 shrink-0 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark"
      >
        How
      </Link>
      <button
        type="button"
        onClick={dismissInstallCard}
        aria-label="Dismiss the install card"
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-muted hover:text-ink"
      >
        <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </section>
  );
}
