import { test } from "node:test";
import assert from "node:assert/strict";
import { scrubBreadcrumb, scrubEvent, scrubText, sentryOptions, stripQuery, type ScrubbableEvent } from "./sentry-scrub.ts";

test("text: emails, IPs, tokens and names in our wording are redacted", () => {
  assert.equal(scrubText("Invite to ana@example.co.nz failed"), "Invite to [email] failed");
  assert.equal(scrubText("from 203.0.113.7"), "from [ip]");
  assert.equal(scrubText("from 2001:db8:85a3::8a2e:370:7334"), "from [ip]::[ip]");
  assert.equal(scrubText("at 10:30 on 20 Nov"), "at 10:30 on 20 Nov", "times are not IPs");
  assert.equal(
    scrubText("Ana's account is turned off, so you can't add hours for them."),
    "[name]'s account is turned off, so you can't add hours for them.",
  );
  assert.equal(scrubText("Mia Brown's hours"), "[name]'s hours");
  assert.equal(scrubText("Bearer abc.def.ghi"), "Bearer [token]");
  assert.equal(scrubText("key eyJhbGciOi.eyJzdWIiOi.sig"), "key [token]");
  assert.equal(scrubText("sb_secret_N7UND0Ug"), "[key]");
  assert.equal(scrubText("/auth/confirm?token_hash=abc123&type=invite"), "/auth/confirm?token_hash=[token]&type=invite");
});

test("URLs lose their query string", () => {
  assert.equal(stripQuery("https://ops.example.nz/auth/confirm?token_hash=abc#x"), "https://ops.example.nz/auth/confirm");
});

test("events lose the user, request body, cookies and headers", () => {
  const event: ScrubbableEvent = {
    user: { id: "u1", email: "ana@example.co.nz", ip_address: "203.0.113.7", username: "Ana" },
    server_name: "host-1",
    request: {
      url: "https://ops.example.nz/leave?x=1",
      data: { reason: "sick", gi_symptoms: true },
      cookies: { "sb-access-token": "secret" },
      headers: { cookie: "sb=1", authorization: "Bearer x", "user-agent": "Safari", "x-forwarded-for": "203.0.113.7" },
      query_string: "x=1",
    },
    message: "Could not save for ana@example.co.nz",
    exception: { values: [{ value: "Ana's account is turned off", stacktrace: { frames: [{ vars: { password: "p" } }] } }] },
    extra: { email: "ana@example.co.nz", note: "call 203.0.113.7", count: 3 },
  };
  const out = scrubEvent(event);
  assert.equal(out.user, undefined);
  assert.equal(out.server_name, undefined);
  assert.equal(out.request?.data, undefined, "no request bodies (leave answers, purchases...)");
  assert.equal(out.request?.cookies, undefined);
  assert.equal(out.request?.query_string, undefined);
  assert.deepEqual(out.request?.headers, { "user-agent": "Safari" });
  assert.equal(out.request?.url, "https://ops.example.nz/leave");
  assert.equal(out.message, "Could not save for [email]");
  assert.equal(out.exception?.values?.[0].value, "[name]'s account is turned off");
  assert.equal(out.exception?.values?.[0].stacktrace?.frames?.[0].vars, undefined);
  assert.deepEqual(out.extra, { email: "[removed]", note: "call [ip]", count: 3 });
});

test("breadcrumbs: no console output, requests keep only method, status and path", () => {
  assert.equal(scrubBreadcrumb({ category: "console", message: "ana@example.co.nz" }), null);
  assert.deepEqual(
    scrubBreadcrumb({
      category: "fetch",
      data: { method: "POST", status_code: 200, url: "https://x.supabase.co/rest/v1/staff?email=eq.ana@x.nz", request_body: "{}" },
    }),
    { category: "fetch", data: { method: "POST", status_code: 200, url: "https://x.supabase.co/rest/v1/staff" } },
  );
  assert.deepEqual(scrubBreadcrumb({ category: "ui.click", message: "Signed in as ana@x.nz" }), {
    category: "ui.click",
    message: "Signed in as [email]",
  });
});

test("Sentry is set up for errors only, never personal details", () => {
  const o = sentryOptions("https://k@o1.ingest.sentry.io/2", undefined);
  assert.equal(o.sendDefaultPii, false);
  assert.equal(o.tracesSampleRate, 0);
  assert.equal(o.environment, "production");
  assert.equal(o.beforeSend({ user: { email: "a@b.nz" } }).user, undefined);
});
