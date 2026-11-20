// Shared checks for files people upload (invoices, sick leave certificates):
// photos or PDFs, at most 5 MB, photos shrunk in the browser first.
// Pure functions: they run in the browser, on the server and under node --test.

export const UPLOAD_MAX_BYTES = 5 * 1024 * 1024; // matches the buckets in config.toml
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
export function uploadExtension(type: string): string | null {
  return EXTENSIONS[type] ?? null;
}

/** Error message for a file the bucket would refuse, or null if it's fine.
 *  Run on the file that will actually upload (after shrinking a photo). */
export function checkUploadFile(file: { type: string; size: number }): string | null {
  if (!uploadExtension(file.type)) return "Use a photo (JPEG, PNG, WebP) or a PDF.";
  if (file.size === 0) return "That file is empty.";
  if (file.size > UPLOAD_MAX_BYTES) return "That file is over 5 MB. Take a photo instead, or shrink the PDF.";
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

/** Size to draw a photo at: at most maxWidth wide, never made bigger. */
export function scaledSize(width: number, height: number, maxWidth = PHOTO_MAX_WIDTH): { width: number; height: number } {
  if (width <= maxWidth) return { width, height };
  return { width: maxWidth, height: Math.round((height * maxWidth) / width) };
}

const OWN_PATH_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[0-9a-f-]{36}\.([a-z]+)$/i;

/** Is this a {owner_id}/{uuid}.{ext} path in this person's own folder, with
 *  one of the allowed extensions? (Sick leave certificates, signatures.) */
export function isOwnFilePath(path: string, ownerId: string, extensions: string[]): boolean {
  const match = OWN_PATH_RE.exec(path);
  return Boolean(match && match[1].toLowerCase() === ownerId.toLowerCase() && extensions.includes(match[2].toLowerCase()));
}
