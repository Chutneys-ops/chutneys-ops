// Pure helpers for purchases: no React, no Supabase, so they run in the
// browser, on the server and under `node --test`.
//
// The database is the real guard (column grants, RLS, check constraints,
// the generated gst_amount). These functions mirror it so the form can
// explain problems before the database says no.

import { aucklandDate } from "./dates.ts";
import { aucklandLocalToUtc } from "./hours.ts";

// ---- Money and GST ---------------------------------------------------------

export const PAYMENT_METHODS = ["company_card", "cash", "own_money"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  company_card: "Company card",
  cash: "Till cash",
  own_money: "Own money",
};

/** "$1,234.50", "115", "12.5" -> cents (123450, 11500, 1250), or null if it
 *  isn't a positive amount with at most 2 decimal places. Cents are whole
 *  numbers, so there are no floating-point surprises like 0.1 + 0.2. */
export function parseMoney(text: string): number | null {
  const cleaned = text.trim().replace(/^\$/, "").replace(/,/g, "").trim();
  const match = /^(\d{1,8})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return cents > 0 ? cents : null;
}

/** GST inside a GST-inclusive total (NZ GST is 15%, so 3/23 of the total).
 *  Same as the database: round(total * 3 / 23, 2), or 0 without GST. */
export function gstCents(totalCents: number, gstIncluded: boolean): number {
  return gstIncluded ? Math.round((totalCents * 3) / 23) : 0;
}

/** 123450 -> "$1,234.50" */
export function formatMoney(cents: number): string {
  const dollars = Math.floor(Math.abs(cents) / 100).toLocaleString("en-NZ");
  const rest = String(Math.abs(cents) % 100).padStart(2, "0");
  return `${cents < 0 ? "-" : ""}$${dollars}.${rest}`;
}

/** A numeric(10,2) from the database (a number or string) -> cents. */
export function toCents(value: number | string): number {
  return Math.round(Number(value) * 100);
}

// ---- The form ------------------------------------------------------------------

export const TEXT_LIMITS = { supplier: 200, description: 500, no_receipt_reason: 500, comments: 500 };

export type PurchaseInput = {
  supplier: string;
  description: string;
  total: string;
  gst_included: string; // "yes" or "no"
  payment_method: string;
  no_receipt_reason: string;
  comments: string;
};

export type PurchaseValues = {
  supplier: string;
  description: string;
  total_incl_gst: string; // "115.00": exact, for the numeric(10,2) column
  gst_included: boolean;
  payment_method: PaymentMethod;
  no_receipt_reason: string | null;
  comments: string | null;
};

export type PurchaseCheck = { values: PurchaseValues | null; errors: Record<string, string> };

/** Check what was typed. `hasInvoice`: a file was uploaded with it. Without
 *  one, a "no receipt" reason is needed (same rule as the database). */
export function validatePurchase(input: PurchaseInput, hasInvoice: boolean): PurchaseCheck {
  const errors: Record<string, string> = {};
  const supplier = input.supplier.trim();
  const description = input.description.trim();
  const reason = input.no_receipt_reason.trim();
  const comments = input.comments.trim();

  if (!supplier) errors.supplier = "Who did you buy from?";
  else if (supplier.length > TEXT_LIMITS.supplier) errors.supplier = `Keep it under ${TEXT_LIMITS.supplier} characters`;

  if (!description) errors.description = "Say what you bought";
  else if (description.length > TEXT_LIMITS.description)
    errors.description = `Keep it under ${TEXT_LIMITS.description} characters`;

  const cents = parseMoney(input.total);
  if (cents === null) errors.total = "Enter the total, like 23.50";

  if (input.gst_included !== "yes" && input.gst_included !== "no") errors.gst_included = "Is GST included?";

  const method = PAYMENT_METHODS.find((m) => m === input.payment_method);
  if (!method) errors.payment_method = "How did you pay?";

  if (!hasInvoice && !reason) errors.no_receipt_reason = "Add an invoice photo, or say why there's no receipt";
  else if (reason.length > TEXT_LIMITS.no_receipt_reason)
    errors.no_receipt_reason = `Keep it under ${TEXT_LIMITS.no_receipt_reason} characters`;

  if (comments.length > TEXT_LIMITS.comments) errors.comments = `Keep it under ${TEXT_LIMITS.comments} characters`;

  if (Object.keys(errors).length > 0 || cents === null || !method) return { values: null, errors };
  return {
    values: {
      supplier,
      description,
      total_incl_gst: (cents / 100).toFixed(2),
      gst_included: input.gst_included === "yes",
      payment_method: method,
      // With an invoice the reason isn't needed, so don't store a stray one.
      no_receipt_reason: hasInvoice ? null : reason,
      comments: comments || null,
    },
    errors,
  };
}

// ---- Invoice files ------------------------------------------------------------

export const INVOICE_MAX_BYTES = 5 * 1024 * 1024; // matches the bucket in config.toml
export const PHOTO_MAX_WIDTH = 1600;
export const PHOTO_QUALITY = 0.7;
export const PHOTO_TARGET_BYTES = 400 * 1024;

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export function isPdf(type: string): boolean {
  return type === "application/pdf";
}

/** "image/jpeg" -> "jpg", or null for a type the bucket won't take. */
export function invoiceExtension(type: string): string | null {
  return EXTENSIONS[type] ?? null;
}

/** Error message for a file the bucket would refuse, or null if it's fine.
 *  Run on the file that will actually upload (after shrinking a photo). */
export function checkInvoiceFile(file: { type: string; size: number }): string | null {
  if (!invoiceExtension(file.type)) return "Use a photo (JPEG, PNG, WebP) or a PDF.";
  if (file.size === 0) return "That file is empty.";
  if (file.size > INVOICE_MAX_BYTES) return "That file is over 5 MB. Take a photo instead, or shrink the PDF.";
  return null;
}

/** A random id (UUID v4) for a file name. crypto.randomUUID() only works on
 *  https or localhost, so testing on a phone over http://192.168... would
 *  break; crypto.getRandomValues works everywhere. */
export function newFileId(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Where an invoice goes: {site_id}/{yyyy}/{mm}/{id}.{ext}, by Auckland month. */
export function invoicePath(siteId: string, when: Date, id: string, ext: string): string {
  const [year, month] = aucklandDate(when).split("-");
  return `${siteId}/${year}/${month}/${id}.${ext}`;
}

const PATH_RE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/i;

/** Is this a well-formed invoice path in this site's folder? */
export function isInvoicePathFor(path: string, siteId: string): boolean {
  const match = PATH_RE.exec(path);
  return Boolean(match && match[1].toLowerCase() === siteId.toLowerCase());
}

/** Size to draw a photo at: at most maxWidth wide, never made bigger. */
export function scaledSize(width: number, height: number, maxWidth = PHOTO_MAX_WIDTH): { width: number; height: number } {
  if (width <= maxWidth) return { width, height };
  return { width: maxWidth, height: Math.round((height * maxWidth) / width) };
}

// ---- Months ---------------------------------------------------------------------

/** "2026-11" for now, in Auckland. */
export function currentMonth(now: Date = new Date()): string {
  return aucklandDate(now).slice(0, 7);
}

export function isMonth(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value));
}

function nextMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** An Auckland month as a UTC range [start, end), for filtering purchased_at.
 *  "2026-11" -> 2026-10-31T11:00:00.000Z to 2026-11-30T11:00:00.000Z. */
export function monthRange(ym: string): { start: string; end: string } {
  const start = aucklandLocalToUtc(`${ym}-01T00:00`);
  const end = aucklandLocalToUtc(`${nextMonth(ym)}-01T00:00`);
  if (!start || !end) throw new Error(`Not a month: ${ym}`);
  return { start: start.toISOString(), end: end.toISOString() };
}

/** "2026-11" -> "November 2026" */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Intl.DateTimeFormat("en-NZ", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, 1)),
  );
}

// ---- CSV --------------------------------------------------------------------------

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

/** One purchase as the export route reads it from the database. */
export type ExportRow = {
  id: string;
  purchased_at: string;
  supplier: string;
  description: string;
  total_incl_gst: number | string;
  gst_amount: number | string;
  payment_method: PaymentMethod;
  invoice_path: string | null;
  no_receipt_reason: string | null;
  site: { name: string } | null;
  buyer: { name: string } | null;
};

export const PURCHASES_CSV_HEADER = [
  "Date",
  "Time",
  "Site",
  "Supplier",
  "Description",
  "Total incl GST",
  "GST",
  "Payment method",
  "Bought by",
  "Invoice link",
  "No receipt reason",
];

/** The owner's monthly export. `origin` is the app's address, e.g.
 *  "https://ops.example.nz", for invoice links that never expire. */
export function purchasesCsv(rows: ExportRow[], origin: string): string {
  return buildCsv(
    PURCHASES_CSV_HEADER,
    rows.map((r) => [
      aucklandDate(new Date(r.purchased_at)),
      aucklandClock24(r.purchased_at),
      r.site?.name ?? "",
      r.supplier,
      r.description,
      Number(r.total_incl_gst).toFixed(2),
      Number(r.gst_amount).toFixed(2),
      PAYMENT_LABELS[r.payment_method],
      r.buyer?.name ?? "",
      // A link to the app, not a signed URL, so it still works next month.
      r.invoice_path ? `${origin}/purchases/invoice/${r.id}` : "",
      r.no_receipt_reason ?? "",
    ]),
  );
}
