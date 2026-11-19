// Date helpers that always use Auckland time, whatever timezone the server
// (or the database) runs in. Vercel servers and Supabase both run in UTC.

const TZ = "Pacific/Auckland";

const dateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const timeFormat = new Intl.DateTimeFormat("en-NZ", {
  timeZone: TZ,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const dayFormat = new Intl.DateTimeFormat("en-NZ", {
  timeZone: TZ,
  weekday: "long",
  day: "numeric",
  month: "long",
});

/** The Auckland date as "YYYY-MM-DD", the format Postgres uses for `date`.
 *  Matches today_nz() in the database. en-CA happens to format as YYYY-MM-DD. */
export function aucklandDate(now: Date = new Date()): string {
  return dateFormat.format(now);
}

/** "10:22 am" in Auckland time. */
export function aucklandTime(value: string | Date): string {
  // Some ICU versions put a narrow no-break space before "am"; make it a plain space.
  return timeFormat.format(new Date(value)).replace(/\s/g, " ");
}

/** "Tuesday, 17 November" in Auckland time. */
export function aucklandDay(now: Date = new Date()): string {
  return dayFormat.format(now);
}

/** The day before a "YYYY-MM-DD" date. Works on the date itself, so
 *  daylight-saving changes can't make it skip or repeat a day. */
export function previousDate(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const shortDayFormat = new Intl.DateTimeFormat("en-NZ", {
  timeZone: TZ,
  weekday: "short",
  day: "numeric",
  month: "short",
});

/** "Fri 20 Nov" in Auckland time. */
export function aucklandShortDay(value: string | Date): string {
  return shortDayFormat.format(new Date(value)).replace(",", "");
}

const ymdFormat = new Intl.DateTimeFormat("en-NZ", {
  timeZone: "UTC", // a plain date has no time or zone; UTC leaves it unchanged
  weekday: "long",
  day: "numeric",
  month: "long",
});

/** "2026-11-20" -> "Friday, 20 November". */
export function formatYmd(ymd: string): string {
  return ymdFormat.format(new Date(`${ymd}T00:00:00Z`));
}
