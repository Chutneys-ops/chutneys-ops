import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { LogoMark } from "@/components/logo-mark";
import { SignOutButton } from "@/components/sign-out-button";
import { EnrolForm, VerifyForm } from "@/components/two-step-forms";
import { createClient } from "@/lib/supabase/server";
import { DEACTIVATED_SIGNOUT_PATH, readSession } from "@/lib/supabase/session";

// Two-step sign-in, straight after the password. getSession() (every
// signed-in page) sends people here while mfa_status() isn't "none":
//   - owners and managers with no authenticator: set one up now;
//   - anyone with an authenticator who signed in with only a password: code.
// Until then the database treats them as staff (managers) or shows them
// nothing (anyone with an authenticator).
export default function MfaPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="flex w-full max-w-sm flex-col gap-5 rounded-2xl border border-line bg-white p-6">
        <Suspense fallback={<p className="text-sm text-muted" role="status">Loading…</p>}>
          <MfaContent />
        </Suspense>
      </div>
    </main>
  );
}

function Heading({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex items-center gap-3">
      <LogoMark size="lg" />
      <div className="flex flex-col">
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="text-sm text-muted">{text}</p>
      </div>
    </div>
  );
}

async function MfaContent() {
  await connection();
  const supabase = await createClient();
  const { userId, me, mfa } = await readSession(supabase);
  if (!userId) redirect("/login");
  if (me && !me.active) redirect(DEACTIVATED_SIGNOUT_PATH);
  if (mfa === "none") redirect("/home");

  return (
    <>
      {mfa === "enrol" ? (
        <>
          <Heading title="Set up two-step sign-in" text="One time, about two minutes." />
          <p className="text-sm text-ink">
            As {me?.role === "owner" ? "the owner" : "a manager"} you can see pay, leave and everyone&apos;s records,
            so a password alone isn&apos;t enough. You&apos;ll also type a 6-digit code from an app on your phone
            when you sign in.
          </p>
          <EnrolForm next="/settings?twostep=added#two-step" firstDevice />
        </>
      ) : (
        <>
          <Heading title="Enter your code" text="From the authenticator app on your phone." />
          <VerifyForm next="/home" />
          <p className="text-sm text-muted">
            Lost your phone? Use your second device if you set one up. If not, ask the owner to reset your two-step
            sign-in (More &gt; Staff).
          </p>
        </>
      )}
      <div className="border-t border-line pt-1 text-sm text-muted">
        {me ? <>Signed in as {me.name}. Not you?</> : null}
        <SignOutButton />
      </div>
    </>
  );
}
