import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { PinForm } from "./pin-form";

export default async function SettingsPage() {
  await connection();
  const supabase = await createClient();

  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) redirect("/login");

  // You can always read your own staff row (RLS "see self or owner").
  const { data: me } = await supabase.from("staff").select("name, role").eq("id", userId).maybeSingle();
  const canSign = me?.role === "manager" || me?.role === "owner";

  return (
    <main className="mx-auto w-full max-w-md px-4 py-6">
      <h1 className="text-3xl font-bold">Settings</h1>
      {me && (
        <p className="mt-1 text-sm text-muted">
          Signed in as {me.name} <span className="capitalize">({me.role})</span>
        </p>
      )}

      <section className="mt-5 rounded-[14px] border border-line bg-white p-4">
        <h2 className="text-lg font-semibold">Sign-off PIN</h2>
        {canSign ? (
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
