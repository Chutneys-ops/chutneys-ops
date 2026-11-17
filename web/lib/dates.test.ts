import { test } from "node:test";
import assert from "node:assert/strict";
import { aucklandDate, aucklandTime } from "./dates.ts";

test("aucklandDate is already tomorrow when UTC is still today", () => {
  // 21:22 UTC on 16 Nov = 10:22 am on 17 Nov in Auckland (NZDT, UTC+13).
  assert.equal(aucklandDate(new Date("2026-11-16T21:22:00Z")), "2026-11-17");
});

test("aucklandDate in winter (NZST, UTC+12)", () => {
  // 12:30 UTC on 1 Jul = 00:30 on 2 Jul in Auckland.
  assert.equal(aucklandDate(new Date("2026-07-01T12:30:00Z")), "2026-07-02");
});

test("aucklandTime shows a short 12-hour time", () => {
  assert.equal(aucklandTime("2026-11-16T21:22:00Z"), "10:22 am");
  assert.equal(aucklandTime("2026-11-17T02:05:00Z"), "3:05 pm");
});
