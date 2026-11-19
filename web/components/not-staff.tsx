import { logout } from "@/app/login/actions";

// Shown when someone can log in but has no staff row yet. Without this,
// /start would send them to /login, and the proxy would send them straight
// back to /start (a redirect loop).
export function NotStaff() {
  return (
    <main className="mx-auto w-full max-w-md px-4 py-6">
      <div role="alert" className="rounded-[14px] border border-warning/30 bg-warning-light p-4">
        <h1 className="text-xl font-bold text-warning">Your account isn&apos;t set up yet</h1>
        <p className="mt-1 text-ink">Ask a manager to add you as staff, then sign in again.</p>
      </div>
      <form action={logout} className="mt-4">
        <button
          type="submit"
          className="min-h-12 w-full rounded-xl border border-line bg-white px-4 font-semibold text-ink hover:border-muted"
        >
          Sign out
        </button>
      </form>
    </main>
  );
}
