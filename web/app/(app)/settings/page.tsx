import { redirect } from "next/navigation";
import { connection } from "next/server";
import { logout } from "@/app/login/actions";
import { NotStaff } from "@/components/not-staff";
import { createClient } from "@/lib/supabase/server";
import { getSession, isManager } from "@/lib/supabase/session";
import { PinForm } from "./pin-form";

// The "More" tab: your account, your sign-off PIN (managers and owner), and
// sign out. Shift controls live in the header (Change site, Clock out).
export default async function SettingsPage() {
  await connection();
  const supabase = await createClient();
  const { userId, me } = await getSession(supabase);
  if (!userId) redirect("/login");
  if (!me) return <NotStaff />;

  return (
    <main className="mx-auto w-full max-w-md px-4 py-6">
      <h1 className="text-3xl font-bold">More</h1>
      <p className="mt-1 text-sm text-muted">
        Signed in as {me.name} <span className="capitalize">({me.role})</span>
      </p>

      <section className="mt-5 rounded-[14px] border border-line bg-white p-4">
        <h2 className="text-lg font-semibold">Sign-off PIN</h2>
        {isManager(me) ? (
          <>
            <p className="mt-1 mb-4 text-sm text-muted">
              You enter this PIN when you verify and sign a day&apos;s food safety records. Only a
              scrambled (hashed) copy is stored, so nobody can look it up.
            </p>
            <PinForm />
          </>
        ) : (
          <p className="mt-1 text-sm text-muted">
            Only managers and owners sign off records, so you don&apos;t need a PIN.
          </p>
        )}
      </section>

      <form action={logout} className="mt-5">
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
