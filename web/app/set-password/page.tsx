import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { LogoMark } from "@/components/logo-mark";
import { createClient } from "@/lib/supabase/server";
import { SetPasswordForm } from "./set-password-form";

// Where invite and password reset links end up (after /auth/confirm).
// The proxy sends signed-out visitors to /login.
export default function SetPasswordPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="flex w-full max-w-sm flex-col gap-5 rounded-2xl border border-line bg-white p-6">
        <div className="flex items-center gap-3">
          <LogoMark size="lg" />
          <div className="flex flex-col">
            <h1 className="text-2xl font-bold">Choose a password</h1>
            <p className="text-sm text-muted">You&apos;ll use it to sign in to Chutneys Ops.</p>
          </div>
        </div>
        {/* Reading the session uses cookies, so it waits inside Suspense. */}
        <Suspense fallback={<p className="text-sm text-muted" role="status">Loading…</p>}>
          <SetPasswordContent />
        </Suspense>
      </div>
    </main>
  );
}

async function SetPasswordContent() {
  await connection();
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/login");
  const email = typeof data.claims.email === "string" ? data.claims.email : null;
  return <SetPasswordForm email={email} />;
}
