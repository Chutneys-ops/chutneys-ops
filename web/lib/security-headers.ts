// Security headers for every response. Pure, so they're unit tested.
//
//   - contentSecurityPolicy(): built per request in proxy.ts, with a fresh
//     random nonce. Next.js reads the nonce from the request's
//     Content-Security-Policy header and adds it to its own scripts, so only
//     scripts that came from us run. Anything injected (a stored
//     "<script>" in a comment, say) has no nonce and is blocked.
//   - STATIC_SECURITY_HEADERS: the same on every response (next.config.ts),
//     including files and API routes the proxy skips.

export type CspOptions = {
  nonce: string;
  /** next dev needs eval (React's error overlay) and a websocket (reloads). */
  dev: boolean;
  /** NEXT_PUBLIC_SUPABASE_URL: the browser uploads files straight to Storage. */
  supabaseUrl: string | undefined;
  /** SENTRY_DSN: error reports go to Sentry's ingest host. Unset = no Sentry. */
  sentryDsn: string | undefined;
  /** Only ask the browser to upgrade http requests when the page itself is
   *  https: locally (http://127.0.0.1) it would break Supabase calls. */
  https: boolean;
};

/** React writes style="display:none" while it streams a page (hiding
 *  content until it's ready). A nonce can't cover a style ATTRIBUTE, so
 *  that one exact value is allowed by its hash: sha256("display:none").
 *  'unsafe-hashes' sounds worse than it is: it allows only attributes whose
 *  text matches a listed hash, nothing else. Checked in the unit test. */
export const DISPLAY_NONE_STYLE_HASH = "'sha256-aqNNdDLnnrDOnTNdkJpYlAxKVJtLt9CtFLklmInuUAE='";

/** "https://abc.supabase.co/rest" -> "https://abc.supabase.co"; bad -> null. */
export function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
  } catch {
    return null;
  }
}

/** A random value for one response. 16 bytes, base64. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export function contentSecurityPolicy(o: CspOptions): string {
  const supabase = originOf(o.supabaseUrl);
  const sentry = originOf(o.sentryDsn);
  const connect = ["'self'", supabase, sentry, o.dev ? "ws:" : null].filter(Boolean);

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // 'strict-dynamic': a script we trusted (it has the nonce) may load the
    // app's other chunks. 'self' is ignored by browsers that understand
    // strict-dynamic, and kept for older ones.
    "script-src": ["'self'", `'nonce-${o.nonce}'`, "'strict-dynamic'", ...(o.dev ? ["'unsafe-eval'"] : [])],
    // Tailwind's CSS file, plus the few <style> tags Next.js adds (nonce).
    // Dev mode injects styles without a nonce, so it allows inline there only.
    "style-src": ["'self'", o.dev ? "'unsafe-inline'" : `'nonce-${o.nonce}'`],
    // style="..." attributes: only React's display:none (see above).
    "style-src-attr": o.dev ? ["'unsafe-inline'"] : ["'unsafe-hashes'", DISPLAY_NONE_STYLE_HASH],
    // data: is the two-step QR code; blob: is a photo preview before upload.
    "img-src": ["'self'", "data:", "blob:"],
    // Inter and Space Grotesk are served from our own domain (next/font).
    "font-src": ["'self'"],
    "connect-src": connect as string[],
    // public/sw.js (phone notifications).
    "worker-src": ["'self'"],
    "manifest-src": ["'self'"],
    "frame-src": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    // Nobody may show the app inside a frame (clickjacking).
    "frame-ancestors": ["'none'"],
  };

  const parts = Object.entries(directives).map(([name, values]) => `${name} ${values.join(" ")}`);
  if (o.https) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

/** Browser features the app never uses are switched off for every page,
 *  so injected code (or a framed page) can't use them either. The camera
 *  stays allowed for this site: "Take photo" on purchases and leave. */
export const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "autoplay=()",
  "browsing-topics=()",
  "camera=(self)",
  "display-capture=()",
  "geolocation=()",
  "gyroscope=()",
  "magnetometer=()",
  "microphone=()",
  "midi=()",
  "payment=()",
  "usb=()",
].join(", ");

export const STATIC_SECURITY_HEADERS: { key: string; value: string }[] = [
  // Always https for two years, subdomains too. Browsers ignore it on http
  // (local development), so it only takes effect once deployed.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The old way of saying frame-ancestors 'none', for old browsers.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
  // Pages we open (signed file links) can't reach back into this window.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];
