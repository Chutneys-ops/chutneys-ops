import { redirect } from "next/navigation";
import { connection } from "next/server";
import { BackLink } from "@/components/back-link";
import { NotStaff } from "@/components/not-staff";
import { EnrolForm, RemoveDeviceForm } from "@/components/two-step-forms";
import { aucklandShortDay } from "@/lib/dates";
import { deviceAdvice, removeWarning } from "@/lib/mfa";
import { createClient } from "@/lib/supabase/server";
import { getSession, isManager } from "@/lib/supabase/session";
import { prefsFrom } from "@/lib/reminders";
import { DeviceMode } from "./device-mode";
import { NotificationSettings } from "./notifications";
import { OpeningTimesForm } from "./opening-times-form";
import { ChangePasswordForm } from "./password-form";
import { PinForm } from "./pin-form";

// Settings (from the More menu): notifications, change password, two-step
// sign-in, this device (shared or personal), your sign-off PIN (managers and
// owner) and sites' opening times and trading days (managers).
// Sign out is on the More menu; shift controls live in the header (Change site).
export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  await connection();
  const { twostep } = await searchParams;
  const supabase = await createClient();
  const { userId, me } = await getSession(supabase);
  if (!userId) redirect("/login");
  if (!me) return <NotStaff />;

  const manager = isManager(me);
  const [{ data: prefRow }, { data: sites }, { data: factors }] = await Promise.all([
    supabase.from("notification_prefs").select("notices, roster, reminders, approvals, payslips").maybeSingle(),
    manager
      ? supabase.from("sites").select("id, name, opens_at, trading_days").eq("active", true).order("name")
      : Promise.resolve({ data: null }),
    supabase.auth.mfa.listFactors(),
  ]);
  // Verified authenticators only (a half-finished setup isn't a device).
  const devices = (factors?.totp ?? []).map((f) => ({
    id: f.id,
    name: f.friendly_name || "Authenticator",
    added: f.created_at,
  }));
  const advice = deviceAdvice(devices.length, manager);

  return (
    <main className="mx-auto w-full max-w-md px-4 pt-2 pb-6">
      <BackLink />
      <h1 className="text-3xl font-bold">Settings</h1>
      <p className="mt-1 text-sm text-muted">
        Signed in as {me.name} <span className="capitalize">({me.role})</span>
      </p>

      <section id="notifications" className="mt-5 rounded-[14px] border border-line bg-white p-4">
        <h2 className="mb-2 text-lg font-semibold">Notifications</h2>
        <NotificationSettings
          prefs={prefsFrom(prefRow)}
          publicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null}
        />
      </section>

      <section className="mt-5 rounded-[14px] border border-line bg-white p-4">
        <h2 className="text-lg font-semibold">Change password</h2>
        <p className="mt-1 mb-4 text-sm text-muted">The password you sign in with.</p>
        <ChangePasswordForm />
      </section>

      <section id="two-step" className="mt-5 scroll-mt-20 rounded-[14px] border border-line bg-white p-4">
        <h2 className="text-lg font-semibold">Two-step sign-in</h2>
        {twostep === "added" && (
          <p role="status" className="mt-2 rounded-xl bg-primary-light px-3 py-2 text-sm font-medium text-primary-dark">
            Two-step sign-in is on. Now add a second device below, so losing your phone doesn&apos;t lock you out.
          </p>
        )}
        <p className="mt-1 mb-4 text-sm text-muted">
          {manager
            ? "Required for managers and the owner: after your password, you type a 6-digit code from an app on your phone."
            : "Optional: after your password, you type a 6-digit code from an app on your phone. Someone who learns your password still can't see your payslips or leave."}
        </p>
        {devices.length > 0 && (
          <ul className="mb-4 divide-y divide-line rounded-xl border border-line">
            {devices.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0">
                  <span className="block font-semibold text-ink">{d.name}</span>
                  <span className="block text-sm text-muted">Added {aucklandShortDay(d.added)}</span>
                </span>
                <RemoveDeviceForm factorId={d.id} name={d.name} warning={removeWarning(devices.length - 1, manager)} />
              </li>
            ))}
          </ul>
        )}
        {advice && (
          <p className="mb-4 rounded-xl bg-warning-light px-3 py-2 text-sm font-medium text-warning">{advice}</p>
        )}
        <EnrolForm next="/settings#two-step" firstDevice={devices.length === 0} />
      </section>

      <section className="mt-5 rounded-[14px] border border-line bg-white p-4">
        <h2 className="text-lg font-semibold">This device</h2>
        <p className="mt-1 mb-4 text-sm text-muted">
          A truck or counter tablet that several people use? Switch this on. It&apos;s remembered on this device only.
        </p>
        <DeviceMode />
      </section>

      <section className="mt-5 rounded-[14px] border border-line bg-white p-4">
        <h2 className="text-lg font-semibold">Sign-off PIN</h2>
        {manager ? (
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

      {manager && sites && sites.length > 0 && (
        <section className="mt-5 rounded-[14px] border border-line bg-white p-4">
          <h2 className="text-lg font-semibold">Opening times and trading days</h2>
          <p className="mt-1 mb-4 text-sm text-muted">
            When each site usually opens, and the days it trades. If the opening checks aren&apos;t done 30
            minutes after opening, the people at that site get a reminder. On days a site doesn&apos;t trade there
            are no fridge or opening-check reminders, and the verifier pack shows those days as closed.
          </p>
          <OpeningTimesForm sites={sites as { id: string; name: string; opens_at: string; trading_days: number[] | null }[]} />
        </section>
      )}
    </main>
  );
}
