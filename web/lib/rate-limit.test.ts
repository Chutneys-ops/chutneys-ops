import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clientIp, hashIp, ipKey, LIMITS, readRateResult, tooManyMessage, userKey } from "./rate-limit.ts";

const ME = "a0000000-0000-0000-0000-00000000000a";
const MIGRATION = readFileSync(new URL("../../supabase/migrations/20261210000000_rate_limits.sql", import.meta.url), "utf8");

test("per-person keys start with the person's id, as the database requires", () => {
  const key = userKey(ME, "invite");
  assert.equal(key, `user:${ME}:invite`);
  // check_rate_limit compares the first 42 characters: 'user:' + 36 + ':'.
  assert.equal(key.slice(0, 42), `user:${ME}:`);
  assert.match(MIGRATION, /left\(key, 42\) <> 'user:' \|\| auth\.uid\(\)::text \|\| ':'/);
});

test("per-IP keys never contain the raw IP", () => {
  const key = ipKey("203.0.113.7", "cron");
  assert.match(key, /^ip:[0-9a-f]{32}:cron$/);
  assert.ok(!key.includes("203.0.113.7"));
  assert.equal(hashIp("203.0.113.7"), hashIp("203.0.113.7"), "same IP, same key (so it counts)");
  assert.notEqual(hashIp("203.0.113.7"), hashIp("203.0.113.8"), "different IPs are counted apart");
});

test("the caller's IP comes from the first x-forwarded-for entry", () => {
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })), "203.0.113.7");
  assert.equal(clientIp(new Headers({ "x-real-ip": "198.51.100.2" })), "198.51.100.2");
  assert.equal(clientIp(new Headers()), "unknown");
});

test("the message rounds up to whole minutes", () => {
  assert.equal(tooManyMessage(1), "Too many attempts, try again in 1 minute.");
  assert.equal(tooManyMessage(60), "Too many attempts, try again in 1 minute.");
  assert.equal(tooManyMessage(61), "Too many attempts, try again in 2 minutes.");
  assert.equal(tooManyMessage(900), "Too many attempts, try again in 15 minutes.");
  assert.equal(tooManyMessage(0), "Too many attempts, try again in 1 minute.");
});

test("reading the database's answer", () => {
  assert.deepEqual(readRateResult({ allowed: true, remaining: 3 }), { allowed: true });
  assert.deepEqual(readRateResult({ allowed: false, retry_after_seconds: 512 }), {
    allowed: false,
    retryAfterSeconds: 512,
    message: "Too many attempts, try again in 9 minutes.",
  });
  // Errors or surprises are refused, never let through.
  assert.equal(readRateResult(null).allowed, false);
  assert.equal(readRateResult({ allowed: "yes" }).allowed, false);
});

test("every limit fits what the database accepts", () => {
  assert.match(MIGRATION, /window_seconds not between 1 and 86400/);
  for (const [name, limit] of Object.entries(LIMITS)) {
    assert.ok(limit.max >= 1, `${name}: at least one try`);
    assert.ok(limit.windowSeconds >= 1 && limit.windowSeconds <= 86400, `${name}: window within a day`);
  }
  // Six digits: 10 guesses in 15 minutes is a 1 in 100,000 chance per window.
  assert.ok(LIMITS.mfaVerify.max <= 10);
});
