import Link from "next/link";
import { logout } from "@/app/login/actions";
import { LogoMark } from "@/components/logo-mark";

// The top bar for signed-in pages: logo (back to all sites), Settings, Sign out.
// Used by app/sites/layout.tsx and app/settings/layout.tsx.
export function AppHeader() {
  return (
    <header className="border-b border-line bg-cream">
      <div className="mx-auto flex w-full max-w-md items-center justify-between gap-2 px-4 py-1">
        <Link href="/sites" className="flex min-h-12 items-center gap-2.5 text-ink">
          <LogoMark />
          <span className="font-display text-[17px] font-semibold">Chutneys Ops</span>
        </Link>
        <div className="flex items-center">
          <Link
            href="/settings"
            className="flex min-h-12 items-center px-2 text-sm font-medium text-primary underline-offset-4 hover:text-primary-dark hover:underline"
          >
            Settings
          </Link>
          <form action={logout}>
            <button
              type="submit"
              className="min-h-12 px-2 text-sm font-medium text-primary underline-offset-4 hover:text-primary-dark hover:underline"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
