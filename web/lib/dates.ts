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
