import { AppHeader } from "@/components/app-header";
import { BottomNav } from "@/components/bottom-nav";

// Wraps every page under /sites: header on top, tab bar at the bottom.
// pb-(--nav-h) keeps the end of each page clear of the tab bar.
export default function SitesLayout({ children }: LayoutProps<"/sites">) {
  return (
    <>
      <AppHeader />
      <div className="pb-(--nav-h)">{children}</div>
      <BottomNav />
    </>
  );
}
