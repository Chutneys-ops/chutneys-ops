"use client";

// Bottom tab bar: Records, Time, Purchases, More.
// A Client Component because it reads the URL (usePathname) to highlight
// the active tab.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, type ReactNode } from "react";

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      className="h-6 w-6"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

// `also`: other paths that belong to the tab, so it stays highlighted there.
const TABS: { label: string; href: string; also?: string[]; icon: ReactNode }[] = [
  {
    label: "Records",
    href: "/records",
    icon: (
      <Icon>
        <path d="M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1z" />
        <path d="M8 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2" />
        <path d="M9 12h6M9 16h4" />
      </Icon>
    ),
  },
  {
    label: "Time",
    href: "/time",
    icon: (
      <Icon>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </Icon>
    ),
  },
  {
    label: "Purchases",
    href: "/purchases",
    icon: (
      <Icon>
        <path d="M5 7h14l-1.5 12a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" />
        <path d="M9 7a3 3 0 0 1 6 0" />
      </Icon>
    ),
  },
  {
    label: "More",
    href: "/more",
    also: ["/leave", "/training", "/settings"],
    icon: (
      <Icon>
        <circle cx="5" cy="12" r="1.5" />
        <circle cx="12" cy="12" r="1.5" />
        <circle cx="19" cy="12" r="1.5" />
      </Icon>
    ),
  },
];

// usePathname needs a <Suspense> boundary under Cache Components on routes
// that are rendered per request. The fallback is the same bar with no tab
// highlighted, so nothing moves when the real one arrives.
export function BottomNav() {
  return (
    <Suspense fallback={<NavBar pathname="" />}>
      <LiveNav />
    </Suspense>
  );
}

function LiveNav() {
  return <NavBar pathname={usePathname()} />;
}

function NavBar({ pathname }: { pathname: string }) {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-20 h-(--nav-h) border-t border-line bg-white pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto grid h-16 max-w-md grid-cols-4">
        {TABS.map((tab) => {
          const active = [tab.href, ...(tab.also ?? [])].some(
            (href) => pathname === href || pathname.startsWith(`${href}/`),
          );
          return (
            <li key={tab.label}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`flex h-full flex-col items-center justify-center gap-0.5 text-xs font-medium ${
                  active ? "text-primary" : "text-muted hover:text-ink"
                }`}
              >
                {tab.icon}
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
