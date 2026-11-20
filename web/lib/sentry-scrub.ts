// What Sentry may see about an error: the error, where it happened, which
// browser. Not who it happened to. Every event (server and browser) goes
// through scrubEvent() before it leaves, and every breadcrumb through
// scrubBreadcrumb(). Pure, so it's unit tested (lib/sentry-scrub.test.ts).
//
// Removed: the user (id, email, name, IP), request bodies, cookies and
// headers, query strings (invite links carry one-time tokens), local
// variables. Redacted inside any text: emails, IP addresses, tokens, and
// names in our own error wording ("Ana's account is turned off").

// Minimal shapes of Sentry's event and breadcrumb (only what we touch), so
// this file doesn't depend on the SDK.
type Frame = { vars?: unknown };
type ExceptionValue = { value?: string; stacktrace?: { frames?: Frame[] } };
export type ScrubbableEvent = {
  message?: string;
  user?: unknown;
  request?: { url?: string; data?: unknown; cookies?: unknown; headers?: Record<string, string>; query_string?: unknown; env?: unknown };
  exception?: { values?: ExceptionValue[] };
  breadcrumbs?: ScrubbableBreadcrumb[];
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  server_name?: string;
};
export type ScrubbableBreadcrumb = { category?: string; message?: string; data?: Record<string, unknown> };

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
// Two or more groups of hex with colons (catches IPv6 without eating times like 10:30).
const IPV6 = /\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{1,4}\b/gi;
// JWTs (eyJ...), Supabase keys, long hex or base64 secrets.
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;
const KEYS = /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const TOKEN_PARAM = /([?&](?:token|token_hash|code|access_token|refresh_token)=)[^&\s#]+/gi;
// "Ana's account", "Mia Brown's hours": a capitalised word (or two) before 's.
const POSSESSIVE_NAME = /\b[A-Z][\p{L}'-]+(?: [A-Z][\p{L}'-]+)?'s\b/gu;

/** Redact personal details inside any text. */
export function scrubText(text: string): string {
  return text
    .replace(JWT, "[token]")
    .replace(KEYS, "[key]")
    .replace(BEARER, "Bearer [token]")
    .replace(TOKEN_PARAM, "$1[token]")
    .replace(EMAIL, "[email]")
    .replace(IPV6, "[ip]")
    .replace(IPV4, "[ip]")
    .replace(POSSESSIVE_NAME, "[name]'s");
}

/** A URL without its query string or fragment. */
export function stripQuery(url: string): string {
  return url.split(/[?#]/)[0];
}

function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[deep]";
  if (typeof value === "string") return scrubText(value);
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = /pass|secret|token|cookie|auth|email|name|phone|address|ip/i.test(k) ? "[removed]" : scrubValue(v, depth + 1);
    }
    return out;
  }
  return value;
}

export function scrubEvent<E extends ScrubbableEvent>(event: E): E {
  delete event.user;
  delete event.server_name;
  if (event.request) {
    const userAgent = event.request.headers?.["user-agent"] ?? event.request.headers?.["User-Agent"];
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.query_string;
    delete event.request.env;
    event.request.headers = userAgent ? { "user-agent": userAgent } : {};
    if (event.request.url) event.request.url = stripQuery(event.request.url);
  }
  if (event.message) event.message = scrubText(event.message);
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = scrubText(ex.value);
    for (const frame of ex.stacktrace?.frames ?? []) delete frame.vars;
  }
  if (event.extra) event.extra = scrubValue(event.extra) as Record<string, unknown>;
  if (event.contexts) {
    // Keep browser, OS, runtime and the like; scrub any free text in them.
    event.contexts = scrubValue(event.contexts) as Record<string, unknown>;
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb).filter((b): b is ScrubbableBreadcrumb => b !== null);
  }
  return event;
}

/** Console messages are dropped (they can print anything). Requests keep
 *  method, status and the URL without its query. */
export function scrubBreadcrumb<B extends ScrubbableBreadcrumb>(crumb: B): B | null {
  if (crumb.category === "console") return null;
  if (crumb.message) crumb.message = scrubText(crumb.message);
  if (crumb.data) {
    const d = crumb.data;
    if (crumb.category === "fetch" || crumb.category === "xhr" || crumb.category === "navigation") {
      const kept: Record<string, unknown> = {};
      if (typeof d.method === "string") kept.method = d.method;
      if (typeof d.status_code === "number") kept.status_code = d.status_code;
      for (const k of ["url", "from", "to"]) {
        if (typeof d[k] === "string") kept[k] = stripQuery(d[k] as string);
      }
      crumb.data = kept;
    } else {
      crumb.data = scrubValue(d) as Record<string, unknown>;
    }
  }
  return crumb;
}

/** Sentry.init options shared by the server and the browser. */
export function sentryOptions(dsn: string, environment: string | undefined) {
  return {
    dsn,
    environment: environment || "production",
    // Never attach IPs, cookies or user details automatically.
    sendDefaultPii: false,
    // Errors only: no performance tracing, no session replay.
    tracesSampleRate: 0,
    beforeSend: <E extends ScrubbableEvent>(event: E) => scrubEvent(event),
    beforeBreadcrumb: <B extends ScrubbableBreadcrumb>(crumb: B) => scrubBreadcrumb(crumb),
  };
}
