// Calling the database's check_rate_limit() (see lib/rate-limit.ts).
import "server-only";

import { clientIp, ipKey, LIMITS, readRateResult, userKey, type LimitName, type RateResult } from "@/lib/rate-limit";
import { createAdminClient } from "./admin";
import type { createClient } from "./server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** One try at `action` by the signed-in person, counted with their own
 *  session (the database only lets them count against their own key). */
export async function limitPerson(supabase: Supabase, userId: string, action: LimitName): Promise<RateResult> {
  const { max, windowSeconds } = LIMITS[action];
  const { data, error } = await supabase.rpc("check_rate_limit", {
    key: userKey(userId, action),
    max_hits: max,
    window_seconds: windowSeconds,
  });
  if (error) console.error(`rate limit ${action}:`, error.message);
  return readRateResult(error ? null : data);
}

/** One try at `action` from this request's IP, for requests with nobody
 *  signed in (the scheduled routes). Uses the secret key ONLY to count:
 *  per-IP keys aren't open to signed-in people, so they can't use up the
 *  server's allowance. */
export async function limitIp(request: Request, action: LimitName): Promise<RateResult> {
  const { max, windowSeconds } = LIMITS[action];
  const { data, error } = await createAdminClient().rpc("check_rate_limit", {
    key: ipKey(clientIp(request.headers), action),
    max_hits: max,
    window_seconds: windowSeconds,
  });
  if (error) console.error(`rate limit ${action}:`, error.message);
  return readRateResult(error ? null : data);
}
