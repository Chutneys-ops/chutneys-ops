import { AppHeader } from "@/components/app-header";
import { BottomNav } from "@/components/bottom-nav";

// Same frame as the /sites pages: header on top, tab bar at the bottom.
export default function SettingsLayout({ children }: LayoutProps<"/settings">) {
  return (
    <>
      <AppHeader />
      <div className="pb-(--nav-h)">{children}</div>
      <BottomNav />
    </>
  );
}
