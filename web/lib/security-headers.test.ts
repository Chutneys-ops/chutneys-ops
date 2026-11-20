import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  contentSecurityPolicy,
  DISPLAY_NONE_STYLE_HASH,
  newNonce,
  originOf,
  STATIC_SECURITY_HEADERS,
} from "./security-headers.ts";

const base = {
  nonce: "abc123==",
  dev: false,
  supabaseUrl: "https://xyz.supabase.co",
  sentryDsn: undefined,
  https: true,
};

function directive(csp: string, name: string): string[] {
  const part = csp.split("; ").find((p) => p.startsWith(`${name} `) || p === name);
  return part ? part.split(" ").slice(1) : [];
}

test("production CSP: only our own scripts, by nonce", () => {
  const csp = contentSecurityPolicy(base);
  assert.deepEqual(directive(csp, "script-src"), ["'self'", "'nonce-abc123=='", "'strict-dynamic'"]);
  assert.deepEqual(directive(csp, "style-src"), ["'self'", "'nonce-abc123=='"]);
  assert.ok(!csp.includes("unsafe-inline"), "no inline scripts or styles in production");
  assert.ok(!csp.includes("unsafe-eval"), "no eval in production");
  assert.deepEqual(directive(csp, "frame-ancestors"), ["'none'"]);
  assert.deepEqual(directive(csp, "object-src"), ["'none'"]);
  assert.ok(csp.endsWith("upgrade-insecure-requests"));
});

test("style attributes: only React's display:none, by its exact hash", () => {
  const csp = contentSecurityPolicy(base);
  assert.deepEqual(directive(csp, "style-src-attr"), ["'unsafe-hashes'", DISPLAY_NONE_STYLE_HASH]);
  const hash = createHash("sha256").update("display:none").digest("base64");
  assert.equal(DISPLAY_NONE_STYLE_HASH, `'sha256-${hash}'`);
});

test("connections: ourselves and Supabase only, plus Sentry when set up", () => {
  assert.deepEqual(directive(contentSecurityPolicy(base), "connect-src"), ["'self'", "https://xyz.supabase.co"]);
  const withSentry = contentSecurityPolicy({ ...base, sentryDsn: "https://key@o123.ingest.us.sentry.io/456" });
  assert.deepEqual(directive(withSentry, "connect-src"), ["'self'", "https://xyz.supabase.co", "https://o123.ingest.us.sentry.io"]);
});

test("local http: no upgrade (it would break Supabase on 127.0.0.1)", () => {
  const csp = contentSecurityPolicy({ ...base, https: false, supabaseUrl: "http://127.0.0.1:54321" });
  assert.ok(!csp.includes("upgrade-insecure-requests"));
  assert.ok(directive(csp, "connect-src").includes("http://127.0.0.1:54321"));
});

test("dev mode adds only what next dev needs", () => {
  const csp = contentSecurityPolicy({ ...base, dev: true });
  assert.ok(directive(csp, "script-src").includes("'unsafe-eval'"));
  assert.ok(directive(csp, "connect-src").includes("ws:"));
});

test("origins are cut down to scheme and host", () => {
  assert.equal(originOf("https://xyz.supabase.co/rest/v1"), "https://xyz.supabase.co");
  assert.equal(originOf("javascript:alert(1)"), null);
  assert.equal(originOf("not a url"), null);
  assert.equal(originOf(undefined), null);
});

test("each nonce is new and random", () => {
  const a = newNonce();
  const b = newNonce();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9+/]{22}==$/);
});

test("the fixed headers are all there", () => {
  const keys = STATIC_SECURITY_HEADERS.map((h) => h.key);
  for (const k of ["Strict-Transport-Security", "X-Content-Type-Options", "Referrer-Policy", "X-Frame-Options", "Permissions-Policy"]) {
    assert.ok(keys.includes(k), k);
  }
  const value = (k: string) => STATIC_SECURITY_HEADERS.find((h) => h.key === k)?.value;
  assert.equal(value("Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.equal(value("X-Content-Type-Options"), "nosniff");
  assert.match(value("Permissions-Policy") ?? "", /microphone=\(\)/);
  assert.match(value("Permissions-Policy") ?? "", /geolocation=\(\)/);
});
