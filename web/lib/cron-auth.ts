// The check every scheduled route (/api/cron/*) starts with: pg_cron sends
// "Authorization: Bearer <CRON_SECRET>". Anything else gets 401 before any work.

import { createHash, timingSafeEqual } from "node:crypto";

/** Constant-time compare (hashing first makes the lengths equal). */
function secretMatches(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export function cronAuthorised(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected || expected.length < 32) return false; // not set up: refuse everything
  const header = request.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  return given.length > 0 && secretMatches(given, expected);
}
