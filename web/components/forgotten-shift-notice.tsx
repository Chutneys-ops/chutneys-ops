import { aucklandShortDay, aucklandTime } from "@/lib/dates";

// Shown to staff whose last shift was never clocked out (open for more than
// 14 hours). Picking a site closes it with zero hours for a manager to fix.
export function ForgottenShiftNotice({ siteName, clockIn }: { siteName: string; clockIn: string }) {
  return (
    <p role="status" className="mt-4 rounded-xl border border-warning/30 bg-warning-light px-3.5 py-3 text-sm text-ink">
      <span className="font-semibold text-warning">
        <span aria-hidden="true">⚠ </span>Your last shift at {siteName} was never clocked out.
      </span>{" "}
      Your manager will fix the time. (Started {aucklandShortDay(clockIn)}, {aucklandTime(clockIn)}.)
    </p>
  );
}
