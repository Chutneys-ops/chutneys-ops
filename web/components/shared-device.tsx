"use client";

// Shared tablets in the browser: the device switch, the 15-minute idle
// sign-out, and clearing what the browser kept when someone signs out.
// The rules (times, which keys) are in lib/shared-device.ts, with tests.

import { useEffect, useSyncExternalStore } from "react";
import { removeSubscription } from "@/app/(app)/settings/notification-actions";
import { logout } from "@/app/login/actions";
import {
  idleTooLong,
  keysToClear,
  LAST_ACTIVE_KEY,
  msUntilIdle,
  parseLastActive,
  SHARED_DEVICE_KEY,
} from "@/lib/shared-device";

// ---- The switch, remembered per device ---------------------------------------------

const listeners = new Set<() => void>();

function readShared(): boolean {
  try {
    return window.localStorage.getItem(SHARED_DEVICE_KEY) === "1";
  } catch {
    return false; // storage blocked: treat as personal
  }
}

function subscribeShared(onChange: () => void) {
  listeners.add(onChange);
  // Another tab changed it.
  const onStorage = (e: StorageEvent) => {
    if (e.key === SHARED_DEVICE_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** null on the server and while hydrating (we can't know yet). */
export function useSharedDevice(): boolean | null {
  return useSyncExternalStore(subscribeShared, readShared, () => null);
}

/** Returns false if the browser won't store it (private mode). */
export function setSharedDevice(shared: boolean): boolean {
  try {
    if (shared) {
      window.localStorage.setItem(SHARED_DEVICE_KEY, "1");
      window.localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()));
    } else {
      window.localStorage.removeItem(SHARED_DEVICE_KEY);
    }
  } catch {
    return false;
  }
  listeners.forEach((l) => l());
  return true;
}

/** Called when someone signs in: their 15 minutes start now, whatever the
 *  last person on this tablet left behind. */
export function markActiveNow(): void {
  try {
    window.localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()));
  } catch {
    // storage blocked
  }
}

// ---- Signing out properly ------------------------------------------------------------

/** Stop this device getting the last person's phone notifications. */
async function forgetPushSubscription(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration("/");
  const sub = await registration?.pushManager?.getSubscription();
  if (!sub) return;
  await removeSubscription(sub.endpoint);
  await sub.unsubscribe();
}

/** Remove what the browser kept for this person. The device's own settings
 *  (shared or not, install card) stay. Never throws. */
async function clearBrowserData(): Promise<void> {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k) keys.push(k);
    }
    keysToClear(keys).forEach((k) => window.localStorage.removeItem(k));
  } catch {
    // storage blocked: nothing was kept there either
  }
  try {
    window.sessionStorage.clear();
  } catch {
    // same
  }
  try {
    if ("caches" in window) {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
    }
  } catch {
    // Cache Storage unavailable (http, private mode)
  }
}

/** Sign out: forget push, clear browser data, end the session, then a full
 *  page load of /login so no page of theirs stays in memory. Never waits
 *  long on a slow browser. */
export async function signOutEverywhereHere(reason?: "idle"): Promise<void> {
  const giveUp = new Promise<void>((resolve) => setTimeout(resolve, 2000));
  await Promise.race([forgetPushSubscription().catch(() => undefined), giveUp]);
  await clearBrowserData();
  try {
    await logout();
  } finally {
    window.location.replace(reason === "idle" ? "/login?notice=idle" : "/login");
  }
}

// ---- The idle guard ------------------------------------------------------------------------

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "scroll", "touchstart"] as const;

function readLastActive(): number | null {
  try {
    return parseLastActive(window.localStorage.getItem(LAST_ACTIVE_KEY));
  } catch {
    return null;
  }
}

/** On every signed-in page. Does nothing on a personal device. On a shared
 *  one, signs out after 15 minutes without use, including when the tablet
 *  wakes up after sleeping (timers don't run while it sleeps). Also: if the
 *  Back button shows a page from the browser's memory after signing out,
 *  reload it, so the server sends them to /login instead. */
export function SharedDeviceGuard() {
  const shared = useSharedDevice();

  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  useEffect(() => {
    if (!shared) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let signingOut = false;
    let lastWrite = 0;

    const check = () => {
      if (signingOut) return;
      const last = readLastActive();
      if (idleTooLong(last, Date.now())) {
        signingOut = true;
        void signOutEverywhereHere("idle");
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(check, msUntilIdle(last, Date.now()) + 500);
    };

    const touch = () => {
      const now = Date.now();
      // At most once every 5 seconds: scrolling fires constantly.
      if (now - lastWrite < 5000) return;
      lastWrite = now;
      try {
        window.localStorage.setItem(LAST_ACTIVE_KEY, String(now));
      } catch {
        // can't record it: the timer below still runs from the last value
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };

    // Coming back to a tablet left on this page: check before anything else.
    check();
    if (!signingOut) touch();
    ACTIVITY_EVENTS.forEach((ev) => window.addEventListener(ev, touch, { passive: true }));
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    return () => {
      clearTimeout(timer);
      ACTIVITY_EVENTS.forEach((ev) => window.removeEventListener(ev, touch));
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
    };
  }, [shared]);

  return null;
}
