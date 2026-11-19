import { Suspense, type ReactNode } from "react";
import { AppHeader, AppHeaderFallback } from "@/components/app-header";
import { BottomNav } from "@/components/bottom-nav";

// Wraps every signed-in page: /start, /records, /time, /purchases, /settings.
// The (app) folder is a "route group": the brackets keep it out of the URL.
//
// The header reads your shift (cookies + database), so it sits in its own
// <Suspense>: the rest of the page doesn't wait for it, and Cache Components
// can still prerender the static parts.
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Suspense fallback={<AppHeaderFallback />}>
        <AppHeader />
      </Suspense>
      <div className="pb-(--nav-h)">{children}</div>
      <BottomNav />
    </>
  );
}
