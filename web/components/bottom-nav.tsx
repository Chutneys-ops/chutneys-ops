"use client";

// Bottom tab bar: Sites, Records, Time, Purchases.
// A Client Component because it reads the current URL (usePathname,
// useParams) to highlight the active tab and to know which site you're on.

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { Suspense, type ReactNode } from "react";

type Tab = { label: string; href: string; active: boolean; icon: ReactNode };

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

// The URL is only known at request time on dynamic routes like
// /sites/[siteId], so Cache Components needs the URL-reading part inside
// <Suspense>. The fallback is the same bar with no tab highlighted, so
// nothing moves when the real one streams in.
export function BottomNav() {
  return (
    <Suspense fallback={<NavBar pathname="" siteId={null} />}>
      <LiveNav />
    </Suspense>
  );
}

function LiveNav() {
  const pathname = usePathname();
  const params = useParams<{ siteId?: string }>();
  const siteId = typeof params.siteId === "string" ? params.siteId : null;
  return <NavBar pathname={pathname} siteId={siteId} />;
}

function NavBar({ pathname, siteId }: { pathname: string; siteId: string | null }) {
  const onRecords = pathname.includes("/records");
  const tabs: Tab[] = [
    {
      label: "Sites",
      href: "/sites",
      active: pathname === "/sites" || (siteId !== null && !onRecords),
      icon: (
        <Icon>
          <path d="M3 10l9-6 9 6v10a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
        </Icon>
      ),
    },
    {
      label: "Records",
      // On a site, go straight to its records. Otherwise pick a site first.
      href: siteId ? `/sites/${siteId}/records` : "/sites?pick=records",
      active: onRecords,
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
      href: "/sites/time",
      active: pathname === "/sites/time",
      icon: (
        <Icon>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </Icon>
      ),
    },
    {
      label: "Purchases",
      href: "/sites/purchases",
      active: pathname === "/sites/purchases",
      icon: (
        <Icon>
          <path d="M5 7h14l-1.5 12a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" />
          <path d="M9 7a3 3 0 0 1 6 0" />
        </Icon>
      ),
    },
  ];

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-20 h-(--nav-h) border-t border-line bg-white pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto grid h-16 max-w-md grid-cols-4">
        {tabs.map((tab) => (
          <li key={tab.label}>
            <Link
              href={tab.href}
              aria-current={tab.active ? "page" : undefined}
              className={`flex h-full flex-col items-center justify-center gap-0.5 text-xs font-medium ${
                tab.active ? "text-primary" : "text-muted hover:text-ink"
              }`}
            >
              {tab.icon}
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
