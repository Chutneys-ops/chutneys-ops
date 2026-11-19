import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aucklandLocalToUtc,
  crossesMidnight,
  isStaleOpen,
  toAucklandLocalInput,
  formatDuration,
  shiftMinutes,
  shiftsThisWeek,
  totalMinutes,
  weekStart,
} from "./hours.ts";

// Auckland is UTC+13 in November (daylight time), so 9:00 am NZDT = 20:00 UTC the day before.

test("a normal day shift", () => {
  // 9:00 am to 3:30 pm on Fri 20 Nov, Auckland
  assert.equal(shiftMinutes({ clock_in: "2026-11-19T20:00:00Z", clock_out: "2026-11-20T02:30:00Z" }), 390);
});

test("a shift crossing midnight is just the time between", () => {
  // 10:00 pm Fri 20 Nov to 2:15 am Sat 21 Nov, Auckland
  const shift = { clock_in: "2026-11-20T09:00:00Z", clock_out: "2026-11-20T13:15:00Z" };
  assert.equal(shiftMinutes(shift), 255);
  assert.equal(crossesMidnight(shift), true);
  assert.equal(crossesMidnight({ clock_in: "2026-11-19T20:00:00Z", clock_out: "2026-11-20T02:30:00Z" }), false);
});

test("an open shift counts up to now", () => {
  const now = new Date("2026-11-20T01:45:00Z");
  assert.equal(shiftMinutes({ clock_in: "2026-11-19T20:00:00Z", clock_out: null }, now), 345);
  assert.equal(crossesMidnight({ clock_in: "2026-11-19T20:00:00Z", clock_out: null }), false);
});

test("a clock-in in the future never counts negative", () => {
  const now = new Date("2026-11-19T19:00:00Z");
  assert.equal(shiftMinutes({ clock_in: "2026-11-19T20:00:00Z", clock_out: null }, now), 0);
});

test("totals add closed and open shifts", () => {
  const now = new Date("2026-11-20T21:00:00Z"); // 10:00 am Sat
  const shifts = [
    { clock_in: "2026-11-19T20:00:00Z", clock_out: "2026-11-20T02:30:00Z" }, // 6 h 30
    { clock_in: "2026-11-20T20:00:00Z", clock_out: null }, // 1 h so far
  ];
  assert.equal(totalMinutes(shifts, now), 450);
  assert.equal(formatDuration(450), "7 h 30 min");
});

test("duration formatting", () => {
  assert.equal(formatDuration(0), "0 min");
  assert.equal(formatDuration(45), "45 min");
  assert.equal(formatDuration(480), "8 h");
  assert.equal(formatDuration(425), "7 h 5 min");
});

test("weeks start on Monday", () => {
  assert.equal(weekStart("2026-11-20"), "2026-11-16"); // Friday -> Monday
  assert.equal(weekStart("2026-11-16"), "2026-11-16"); // Monday stays
  assert.equal(weekStart("2026-11-22"), "2026-11-16"); // Sunday -> previous Monday
  assert.equal(weekStart("2026-12-01"), "2026-11-30"); // across a month end
});

test("this week uses the Auckland date of clock_in", () => {
  const shifts = [
    // 8:00 am Mon 16 Nov Auckland = Sun 15 Nov 19:00 UTC: still this week
    { clock_in: "2026-11-15T19:00:00Z", clock_out: "2026-11-15T23:00:00Z" },
    // 11:00 pm Sun 15 Nov Auckland: last week
    { clock_in: "2026-11-15T10:00:00Z", clock_out: "2026-11-15T14:00:00Z" },
  ];
  assert.deepEqual(shiftsThisWeek(shifts, "2026-11-20"), [shifts[0]]);
});

test("a forgotten clock-out (open over 14 hours) counts zero, like the database", () => {
  const now = new Date("2026-11-20T23:00:00Z");
  const stale = { clock_in: "2026-11-20T08:00:00Z", clock_out: null }; // 15 hours ago
  const fresh = { clock_in: "2026-11-20T10:00:00Z", clock_out: null }; // 13 hours ago
  assert.equal(isStaleOpen(stale, now), true);
  assert.equal(shiftMinutes(stale, now), 0);
  assert.equal(isStaleOpen(fresh, now), false);
  assert.equal(shiftMinutes(fresh, now), 13 * 60);
  // A closed long shift is real hours, not stale.
  assert.equal(shiftMinutes({ clock_in: "2026-11-20T08:00:00Z", clock_out: "2026-11-20T23:00:00Z" }, now), 15 * 60);
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

test("the day daylight saving starts (27 Sep 2026): morning is already UTC+13", () => {
  assert.equal(aucklandLocalToUtc("2026-09-27T09:00")?.toISOString(), "2026-09-26T20:00:00.000Z");
  assert.equal(aucklandLocalToUtc("2026-09-27T01:30")?.toISOString(), "2026-09-26T13:30:00.000Z");
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
