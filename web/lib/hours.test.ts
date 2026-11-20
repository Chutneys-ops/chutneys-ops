import { test } from "node:test";
import assert from "node:assert/strict";
import { aucklandLocalToUtc, toAucklandLocalInput, weekStart } from "./hours.ts";

// Auckland is UTC+13 in November (daylight time), so 9:00 am NZDT = 20:00 UTC the day before.

test("weeks start on Monday", () => {
  assert.equal(weekStart("2026-11-20"), "2026-11-16"); // Friday -> Monday
  assert.equal(weekStart("2026-11-16"), "2026-11-16"); // Monday stays
  assert.equal(weekStart("2026-11-22"), "2026-11-16"); // Sunday -> previous Monday
  assert.equal(weekStart("2026-12-01"), "2026-11-30"); // across a month end
});

test("Auckland summer time (NZDT, UTC+13) to UTC", () => {
  assert.equal(aucklandLocalToUtc("2026-11-20T17:30")?.toISOString(), "2026-11-20T04:30:00.000Z");
});

test("Auckland winter time (NZST, UTC+12) to UTC", () => {
  assert.equal(aucklandLocalToUtc("2026-07-01T09:00")?.toISOString(), "2026-06-30T21:00:00.000Z");
});

test("just after midnight in Auckland is still the day before in UTC", () => {
  assert.equal(aucklandLocalToUtc("2026-11-21T00:30")?.toISOString(), "2026-11-20T11:30:00.000Z");
});

test("bad input gives null", () => {
  assert.equal(aucklandLocalToUtc("2026-02-30T10:00"), null);
  assert.equal(aucklandLocalToUtc("tomorrow"), null);
  assert.equal(aucklandLocalToUtc("2026-11-20 17:30"), null);
});

test("UTC back to the Auckland picker format round-trips", () => {
  assert.equal(toAucklandLocalInput("2026-11-20T04:30:00Z"), "2026-11-20T17:30");
  assert.equal(toAucklandLocalInput(aucklandLocalToUtc("2026-07-01T09:00")!), "2026-07-01T09:00");
});
