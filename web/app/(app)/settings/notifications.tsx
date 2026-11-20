"use client";

// Settings > Notifications.
//
// - "Turn on notifications" asks the browser for permission ONLY when
//   tapped (iPhone refuses a prompt that isn't from a tap), registers the
//   service worker (public/sw.js), subscribes with the VAPID public key and
//   saves the subscription for you.
// - "Send me a test" pushes to every device you've turned on.
// - Four switches decide which kinds you get, on every device.
// - On iPhone, Safari only offers notifications to an app added to the
//   Home Screen, so it shows how to do that first.

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { usePlatform } from "@/components/install-status";
import { CATEGORIES, CATEGORY_LABELS, type Category, type Prefs } from "@/lib/reminders";
import { isMyDevice, removeSubscription, saveSubscription, sendTest, setPref } from "./notification-actions";

type Support = "checking" | "supported" | "needs-install" | "unsupported";

/** The VAPID public key (base64url) as bytes, which subscribe() needs. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

function pushAvailable(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function registerWorker(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  return navigator.serviceWorker.ready;
}

const buttonPrimary =
  "min-h-12 w-full rounded-xl bg-primary px-4 text-base font-semibold text-white hover:bg-primary-dark disabled:cursor-wait disabled:opacity-70";
const buttonSecondary =
  "min-h-12 w-full rounded-xl border border-line bg-white px-4 font-semibold text-ink hover:border-muted disabled:cursor-wait disabled:opacity-70";

export function NotificationSettings({ prefs: initialPrefs, publicKey }: { prefs: Prefs; publicKey: string | null }) {
  const platform = usePlatform();
  const [support, setSupport] = useState<Support>("checking");
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [deviceOn, setDeviceOn] = useState(false);
  const [prefs, setPrefs] = useState(initialPrefs);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, startBusy] = useTransition();

  // What can this browser do, and is it already on for you?
  useEffect(() => {
    if (platform === "unknown") return;
    let cancelled = false;
    (async () => {
      if (!pushAvailable()) {
        // iPhone Safari has no PushManager until the app is on the Home Screen.
        if (!cancelled) setSupport(platform === "ios" ? "needs-install" : "unsupported");
        return;
      }
      const registration = await registerWorker().catch(() => null);
      const sub = await registration?.pushManager.getSubscription();
      const mine = sub ? await isMyDevice(sub.endpoint) : false;
      if (cancelled) return;
      setPermission(Notification.permission);
      setDeviceOn(mine && Notification.permission === "granted");
      setSupport("supported");
    })();
    return () => {
      cancelled = true;
    };
  }, [platform]);

  function turnOn() {
    setMessage(null);
    startBusy(async () => {
      if (!publicKey) {
        setMessage({ ok: false, text: "Notifications aren't set up on the server yet (VAPID keys)." });
        return;
      }
      // First thing after the tap: the permission prompt.
      const answer = await Notification.requestPermission();
      setPermission(answer);
      if (answer !== "granted") {
        setMessage({ ok: false, text: "Notifications weren't allowed. See below to allow them." });
        return;
      }
      try {
        const registration = await registerWorker();
        const key = keyBytes(publicKey);
        let sub = await registration.pushManager.getSubscription();
        // Made with an old key (the server's keys changed): start again.
        if (sub && !sameKey(sub.options.applicationServerKey, key)) {
          await sub.unsubscribe();
          sub = null;
        }
        sub ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        const json = sub.toJSON();
        const result = await saveSubscription(
          { endpoint: sub.endpoint, p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
          navigator.userAgent,
        );
        setDeviceOn(result.ok);
        setMessage({ ok: result.ok, text: result.message ?? "" });
      } catch (error) {
        setMessage({ ok: false, text: `This browser couldn't turn notifications on: ${(error as Error).message}` });
      }
    });
  }

  function turnOff() {
    setMessage(null);
    startBusy(async () => {
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.getSubscription();
      if (sub) {
        await removeSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
      setDeviceOn(false);
      setMessage({ ok: true, text: "Notifications are off for this device." });
    });
  }

  function test() {
    setMessage(null);
    startBusy(async () => {
      const result = await sendTest();
      setMessage({ ok: result.ok, text: result.message ?? "" });
    });
  }

  function toggle(category: Category, on: boolean) {
    const before = prefs;
    setPrefs({ ...prefs, [category]: on });
    startBusy(async () => {
      const result = await setPref(category, on);
      if (!result.ok) {
        setPrefs(before);
        setMessage({ ok: false, text: result.message ?? "Could not save." });
      }
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Get a notification on this phone or computer for new notices, your roster, records not done yet and
        approvals. Turn them on on each device you use.
      </p>

      {support === "checking" && <p className="text-sm text-muted">Checking this device…</p>}

      {support === "needs-install" && (
        <div className="rounded-xl bg-cream px-3 py-3 text-sm text-ink">
          <p className="font-semibold">On iPhone and iPad, add the app to your Home Screen first.</p>
          <p className="mt-1">
            Then open Chutneys Ops from the Home Screen icon, come back to Settings and turn notifications on.{" "}
            <Link href="/install" className="font-semibold text-primary-dark underline">
              How to add it
            </Link>
          </p>
        </div>
      )}

      {support === "unsupported" && (
        <p className="rounded-xl bg-cream px-3 py-3 text-sm text-ink">
          This browser can&apos;t show notifications. Try Chrome, Edge, Firefox or Safari, or{" "}
          <Link href="/install" className="font-semibold text-primary-dark underline">
            install the app
          </Link>
          .
        </p>
      )}

      {support === "supported" && (
        <div className="space-y-3">
          {permission === "denied" ? (
            <p className="rounded-xl bg-warning-light px-3 py-3 text-sm font-medium text-warning">
              Notifications are blocked for this app. Allow them in your browser&apos;s site settings (or your
              phone&apos;s Settings &gt; Notifications), then come back and tap Turn on.
            </p>
          ) : null}
          <p className="text-sm font-semibold text-ink">
            This device: {deviceOn ? <span className="text-primary-dark">On</span> : <span className="text-muted">Off</span>}
          </p>
          {deviceOn ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={test} disabled={busy} className={buttonPrimary}>
                Send me a test
              </button>
              <button type="button" onClick={turnOff} disabled={busy} className={buttonSecondary}>
                Turn off on this device
              </button>
            </div>
          ) : (
            <button type="button" onClick={turnOn} disabled={busy || permission === "denied"} className={buttonPrimary}>
              {busy ? "Turning on…" : "Turn on notifications"}
            </button>
          )}
          <p className="text-xs text-muted">
            On iPhone, notifications only work in the app added to your Home Screen (
            <Link href="/install" className="underline">
              how
            </Link>
            ).
          </p>
        </div>
      )}

      {message && (
        <p
          role={message.ok ? "status" : "alert"}
          className={
            message.ok
              ? "rounded-xl bg-primary-light px-3 py-2 text-sm font-medium text-primary-dark"
              : "rounded-xl bg-warning-light px-3 py-2 text-sm font-medium text-warning"
          }
        >
          {message.text}
        </p>
      )}

      <fieldset className="pt-1">
        <legend className="text-sm font-semibold text-ink">What to send me</legend>
        <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
          {CATEGORIES.map((c) => (
            <li key={c}>
              <label className="flex min-h-14 cursor-pointer items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold text-ink">{CATEGORY_LABELS[c].label}</span>
                  <span className="block text-sm text-muted">{CATEGORY_LABELS[c].hint}</span>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={prefs[c]}
                  onChange={(e) => toggle(c, e.target.checked)}
                  className="h-6 w-6 shrink-0 accent-primary"
                />
              </label>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted">These apply to every device you&apos;ve turned on.</p>
      </fieldset>
    </div>
  );
}
