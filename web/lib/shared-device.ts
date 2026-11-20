// Shared tablets: the rules, kept pure so they're unit tested.
//
// A truck's tablet is used by whoever is on. Settings has a switch "This is
// a shared device", remembered in this browser only (localStorage). When on:
//   - 15 minutes without a tap, key press or scroll signs the person out;
//   - signing out (always, shared or not) also clears what the browser kept
//     for them: Cache Storage, sessionStorage and our own localStorage keys,
//     except the device-level ones below.
// The browser parts are in components/shared-device.tsx.

export const SHARED_DEVICE_KEY = "chutneys.sharedDevice";
/** When someone last used the app on this device (ms since 1970). Shared
 *  across tabs, so a busy tab keeps a quiet one signed in. */
export const LAST_ACTIVE_KEY = "chutneys.lastActive";
export const IDLE_LIMIT_MS = 15 * 60 * 1000;

/** Device settings, not anyone's personal data: kept when signing out. */
export const KEEP_ON_SIGN_OUT: readonly string[] = [SHARED_DEVICE_KEY, "chutneys.installCardDismissed"];

/** Has the device been left alone for too long? No record yet = no. */
export function idleTooLong(lastActive: number | null, now: number, limit = IDLE_LIMIT_MS): boolean {
  return lastActive !== null && Number.isFinite(lastActive) && now - lastActive >= limit;
}

/** Milliseconds until the idle sign-out, never below 0. */
export function msUntilIdle(lastActive: number | null, now: number, limit = IDLE_LIMIT_MS): number {
  if (lastActive === null || !Number.isFinite(lastActive)) return limit;
  return Math.max(0, lastActive + limit - now);
}

/** "1234567890" -> 1234567890; anything else -> null. */
export function parseLastActive(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Which localStorage keys to remove on sign out: everything of ours except
 *  the device-level settings. Other sites' keys don't exist here (each site
 *  has its own storage), but anything not starting "chutneys." is left. */
export function keysToClear(keys: readonly string[]): string[] {
  return keys.filter((k) => k.startsWith("chutneys.") && !KEEP_ON_SIGN_OUT.includes(k));
}

/** Settings > This device: what it says for each mode. */
export function deviceModeText(shared: boolean): { title: string; detail: string } {
  return shared
    ? {
        title: "Shared device",
        detail: "Signs out after 15 minutes without use. Signing out clears what this device kept.",
      }
    : {
        title: "Personal device",
        detail: "You stay signed in. Turn this on for a tablet that several people use.",
      };
}
