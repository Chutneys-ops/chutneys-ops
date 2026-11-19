import Link from "next/link";
import { logout } from "@/app/login/actions";
import { LogoMark } from "@/components/logo-mark";

// Wraps every page under /sites, so the header shows on the sites list and
// on each checklist, but not on /login.
export default function SitesLayout({ children }: LayoutProps<"/sites">) {
  return (
    <>
      <header className="border-b border-line bg-cream">
        <div className="mx-auto flex w-full max-w-md items-center justify-between px-4 py-2">
          <Link href="/sites" className="flex min-h-11 items-center gap-2.5 text-ink">
            <LogoMark />
            <span className="font-display text-[17px] font-semibold">Chutneys Ops</span>
          </Link>
          <form action={logout}>
            <button
              type="submit"
              className="min-h-11 px-2 text-sm font-medium text-primary underline-offset-4 hover:text-primary-dark hover:underline"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>
      {children}
    </>
  );
}
