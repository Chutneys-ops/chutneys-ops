// Trading days per site (sites.trading_days): ISO weekday numbers,
// 1 = Monday ... 7 = Sunday. Pure helpers, used by the verifier pack, the
// reminders and Settings, and run under `node --test`.
//
// The database is the real guard (valid_trading_days in the trading days
// migration); these mirror it so the form can explain clearly.

export const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export const DAY_SHORT: Record<number, string> = { 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat", 7: "Sun" };
export const DAY_LONG: Record<number, string> = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
  7: "Sunday",
};

/** The ISO weekday of a plain "YYYY-MM-DD" date (1 = Monday ... 7 = Sunday).
 *  A plain date has no time zone, so UTC reads it unchanged. */
export function isoWeekday(ymd: string): number {
  const day = new Date(`${ymd}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return day === 0 ? 7 : day;
}

/** Does a site with these trading days trade on this date? A missing or
 *  empty list means every day (the database default). */
export function isTradingDay(days: readonly number[] | null | undefined, ymd: string): boolean {
  if (!days || days.length === 0) return true;
  return days.includes(isoWeekday(ymd));
}

/** Form values (strings) -> sorted unique days, or what's wrong. */
export function parseTradingDays(values: readonly unknown[]): { days: number[]; error: string | null } {
  const days = [...new Set(values.map((v) => Number(v)))].sort((a, b) => a - b);
  if (days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
    return { days: [], error: "Days must be Monday to Sunday" };
  }
  if (days.length === 0) return { days, error: "Choose at least one trading day" };
  return { days, error: null };
}

/** "Every day", "Mon to Fri", "Wed to Sun", "Mon, Wed, Fri", "Sat and Sun". */
export function tradingDaysText(days: readonly number[] | null | undefined): string {
  const sorted = [...new Set(days && days.length ? days : ALL_DAYS)].sort((a, b) => a - b);
  if (sorted.length === 7) return "Every day";
  const consecutive = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  if (consecutive && sorted.length >= 3) return `${DAY_SHORT[sorted[0]]} to ${DAY_SHORT[sorted.at(-1)!]}`;
  const names = sorted.map((d) => DAY_SHORT[d]);
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
