import { redirect } from "next/navigation";
import { connection } from "next/server";
import { BackLink } from "@/components/back-link";
import { NotStaff } from "@/components/not-staff";
import { createClient } from "@/lib/supabase/server";
import { getSession, isManager } from "@/lib/supabase/session";
import { PinForm } from "./pin-form";

// Settings (from the More menu): your account and your sign-off PIN
// (managers and owner). Sign out is on the More menu; shift controls live in
// the header (Change site, Clock out).
export default async function SettingsPage() {
  await connection();
  const supabase = await createClient();
  const { userId, me } = await getSession(supabase);
  if (!userId) redirect("/login");
  if (!me) return <NotStaff />;

  return (
    <main className="mx-auto w-full max-w-md px-4 pt-2 pb-6">
      <BackLink />
      <h1 className="text-3xl font-bold">Settings</h1>
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
    </main>
  );
}
