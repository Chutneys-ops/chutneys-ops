// CSV helpers shared by the exports (purchases, hours and leave).

export type CsvCell = string | number | null | undefined;

/** One CSV cell. Quotes when needed (RFC 4180). Text starting with = + - @
 *  gets a ' in front, so Excel shows it instead of running it as a formula
 *  (a supplier called "=HYPERLINK(...)" could otherwise do harm). */
export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Rows -> CSV text with Windows line endings (what Excel expects). */
export function buildCsv(header: string[], rows: CsvCell[][]): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

const clock24 = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Pacific/Auckland",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "14:05": 24-hour Auckland time, which sorts and filters well in Excel. */
export function aucklandClock24(value: string | Date): string {
  return clock24.format(new Date(value));
}
