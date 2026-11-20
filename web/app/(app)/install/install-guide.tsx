"use client";

// Install steps for iPhone and Android, with pictures drawn in SVG (no
// screenshots). Your platform's steps come first; "Already installed" when
// the app is running from the home screen.

import type { ReactNode } from "react";
import { usePlatform } from "@/components/install-status";

// ---- Pictures --------------------------------------------------------------------------

/** A phone outline, 120 x 200, with the screen content drawn inside. */
function Phone({ children, label }: { children: ReactNode; label: string }) {
  return (
    <svg role="img" aria-label={label} viewBox="0 0 120 200" className="h-40 w-24 shrink-0">
      <rect x="2" y="2" width="116" height="196" rx="16" className="fill-white stroke-ink" strokeWidth="3" />
      <rect x="10" y="14" width="100" height="172" rx="6" className="fill-cream" />
      {children}
    </svg>
  );
}

const highlight = "fill-none stroke-primary";

function SafariShare() {
  return (
    <Phone label="Safari with the Share button highlighted at the bottom">
      <rect x="18" y="24" width="84" height="10" rx="5" className="fill-line" />
      <rect x="18" y="44" width="84" height="40" rx="4" className="fill-white" />
      <rect x="18" y="90" width="60" height="6" rx="3" className="fill-line" />
      <rect x="18" y="102" width="70" height="6" rx="3" className="fill-line" />
      {/* bottom toolbar */}
      <rect x="10" y="160" width="100" height="26" className="fill-white" />
      {/* share icon: box with an arrow up */}
      <path d="M53 166v10M49 170l4-4 4 4" className="fill-none stroke-ink" strokeWidth="2" strokeLinecap="round" />
      <path d="M48 172v8h10v-8" className="fill-none stroke-ink" strokeWidth="2" strokeLinecap="round" />
      <circle cx="53" cy="173" r="11" className={highlight} strokeWidth="3" />
    </Phone>
  );
}

function ShareSheet({ title, row }: { title: string; row: string }) {
  return (
    <Phone label={`${title} with "${row}" highlighted`}>
      <rect x="10" y="70" width="100" height="116" rx="8" className="fill-white" />
      <rect x="18" y="80" width="84" height="12" rx="3" className="fill-line" />
      <rect x="18" y="98" width="84" height="12" rx="3" className="fill-line" />
      <rect x="16" y="116" width="88" height="18" rx="4" className="fill-primary-light" />
      <text x="22" y="128" fontSize="9" fontWeight="700" className="fill-primary-dark">
        {row}
      </text>
      <rect x="16" y="116" width="88" height="18" rx="4" className={highlight} strokeWidth="2.5" />
      <rect x="18" y="140" width="84" height="12" rx="3" className="fill-line" />
    </Phone>
  );
}

function ChromeMenu() {
  return (
    <Phone label="Chrome with the three-dot menu highlighted at the top right">
      <rect x="10" y="14" width="100" height="22" className="fill-white" />
      <rect x="16" y="20" width="70" height="10" rx="5" className="fill-line" />
      <circle cx="98" cy="21" r="1.8" className="fill-ink" />
      <circle cx="98" cy="25" r="1.8" className="fill-ink" />
      <circle cx="98" cy="29" r="1.8" className="fill-ink" />
      <circle cx="98" cy="25" r="9" className={highlight} strokeWidth="3" />
      <rect x="18" y="46" width="84" height="40" rx="4" className="fill-white" />
      <rect x="18" y="92" width="60" height="6" rx="3" className="fill-line" />
      <rect x="18" y="104" width="70" height="6" rx="3" className="fill-line" />
    </Phone>
  );
}

function HomeScreenIcon() {
  return (
    <Phone label="The home screen with the green Chutneys icon">
      {[0, 1, 2].map((row) =>
        [0, 1, 2].map((col) =>
          row === 1 && col === 1 ? null : (
            <rect key={`${row}-${col}`} x={22 + col * 28} y={36 + row * 34} width="20" height="20" rx="5" className="fill-line" />
          ),
        ),
      )}
      <rect x="50" y="70" width="20" height="20" rx="5" className="fill-primary" />
      <text x="60" y="85" fontSize="13" fontWeight="700" textAnchor="middle" className="fill-white">
        C
      </text>
      <text x="60" y="100" fontSize="7" textAnchor="middle" className="fill-ink">
        Chutneys
      </text>
      <circle cx="60" cy="80" r="15" className={highlight} strokeWidth="2.5" />
    </Phone>
  );
}

// ---- Steps -------------------------------------------------------------------------------

function Step({ n, picture, children }: { n: number; picture: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-4 py-3">
      {picture}
      <div className="min-w-0">
        <p className="text-sm font-semibold text-primary">Step {n}</p>
        <p className="text-[15px] text-ink">{children}</p>
      </div>
    </li>
  );
}

function IPhoneSteps() {
  return (
    <section className="mt-4 rounded-[14px] border border-line bg-white p-4">
      <h2 className="text-lg font-semibold">iPhone or iPad</h2>
      <ol className="divide-y divide-line">
        <Step n={1} picture={<SafariShare />}>
          Open this app in <strong>Safari</strong> and tap the <strong>Share</strong> button (the square with an
          arrow).
        </Step>
        <Step n={2} picture={<ShareSheet title="The share menu" row="Add to Home Screen" />}>
          Scroll down and tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
        </Step>
        <Step n={3} picture={<HomeScreenIcon />}>
          Open <strong>Chutneys</strong> from your home screen. It opens full screen, like an app.
        </Step>
      </ol>
    </section>
  );
}

function AndroidSteps() {
  return (
    <section className="mt-4 rounded-[14px] border border-line bg-white p-4">
      <h2 className="text-lg font-semibold">Android</h2>
      <ol className="divide-y divide-line">
        <Step n={1} picture={<ChromeMenu />}>
          Open this app in <strong>Chrome</strong> and tap the <strong>three dots</strong> at the top right.
        </Step>
        <Step n={2} picture={<ShareSheet title="The Chrome menu" row="Install app" />}>
          Tap <strong>Install app</strong> (or <strong>Add to Home screen</strong>), then <strong>Install</strong>.
        </Step>
        <Step n={3} picture={<HomeScreenIcon />}>
          Open <strong>Chutneys</strong> from your home screen or app drawer.
        </Step>
      </ol>
    </section>
  );
}

export function InstallGuide() {
  const platform = usePlatform();

  if (platform === "standalone") {
    return (
      <p role="status" className="mt-4 rounded-[14px] border border-primary/30 bg-primary-light p-4 text-[15px] text-primary-dark">
        <span className="font-semibold">Already installed.</span> You&apos;re using the app from your home screen.
      </p>
    );
  }

  // Android first on Android; otherwise iPhone first (also before the
  // browser has said which it is).
  return platform === "android" ? (
    <>
      <AndroidSteps />
      <IPhoneSteps />
    </>
  ) : (
    <>
      <IPhoneSteps />
      <AndroidSteps />
    </>
  );
}
