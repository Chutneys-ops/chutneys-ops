"use client";

// Is the app installed (running standalone), and which phone is this?
// Used by the install card on Home and the /install page.
//
// useSyncExternalStore reads browser-only things (matchMedia, userAgent,
// localStorage) without a hydration mismatch: on the server and during
// hydration it uses the "server snapshot", then switches to the real value.

import { useSyncExternalStore } from "react";

export type Platform = "standalone" | "ios" | "android" | "other" | "unknown";

const STANDALONE_QUERY = "(display-mode: standalone)";

function detectPlatform(): Platform {
  const nav = navigator as Navigator & { standalone?: boolean };
  if (window.matchMedia?.(STANDALONE_QUERY).matches || nav.standalone === true) return "standalone";
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; a touch screen gives it away.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "other";
}

function subscribePlatform(onChange: () => void) {
  const media = window.matchMedia?.(STANDALONE_QUERY);
  media?.addEventListener("change", onChange);
  return () => media?.removeEventListener("change", onChange);
}

/** "unknown" until the browser has hydrated, then the real platform. */
export function usePlatform(): Platform {
  return useSyncExternalStore(subscribePlatform, detectPlatform, () => "unknown");
}

// ---- "Install the app" card dismissal, remembered per device -----------------------

const DISMISS_KEY = "chutneys.installCardDismissed";
const listeners = new Set<() => void>();
// Also remembered in memory, so the card still hides for this page view if
// the browser blocks storage (private mode).
let dismissedInMemory = false;

function readDismissed(): boolean {
  if (dismissedInMemory) return true;
  try {
    return window.localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false; // storage blocked: show the card
  }
}

function subscribeDismissed(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** True once dismissed on this device. Hidden (true) on the server. */
export function useInstallCardDismissed(): boolean {
  return useSyncExternalStore(subscribeDismissed, readDismissed, () => true);
}

export function dismissInstallCard() {
  dismissedInMemory = true;
  try {
    window.localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    // Can't remember it on this device; it stays hidden until a reload.
  }
  listeners.forEach((listener) => listener());
}
