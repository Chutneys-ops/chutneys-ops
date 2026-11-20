import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { breakSummary, hoursText, minutesBetween, nzBreaks, paidMinutes, parseHHMM } from "./breaks.ts";

test("every boundary in the Employment NZ table", () => {
  const h = (hours: number, minutes = 0) => hours * 60 + minutes;
  assert.deepEqual(nzBreaks(h(1, 59)), { rest: 0, meal: 0 }); // under 2h
  assert.deepEqual(nzBreaks(h(2)), { rest: 1, meal: 0 }); // exactly 2h
  assert.deepEqual(nzBreaks(h(4)), { rest: 1, meal: 0 }); // exactly 4h
  assert.deepEqual(nzBreaks(h(4, 1)), { rest: 1, meal: 1 }); // 4h01
  assert.deepEqual(nzBreaks(h(6)), { rest: 1, meal: 1 }); // exactly 6h
  assert.deepEqual(nzBreaks(h(6, 1)), { rest: 2, meal: 1 }); // 6h01
  assert.deepEqual(nzBreaks(h(10)), { rest: 2, meal: 1 }); // exactly 10h
  assert.deepEqual(nzBreaks(h(10, 1)), { rest: 3, meal: 1 }); // 10h01
  assert.deepEqual(nzBreaks(h(12)), { rest: 3, meal: 1 }); // exactly 12h
  assert.deepEqual(nzBreaks(h(14)), { rest: 3, meal: 2 }); // exactly 14h
  assert.deepEqual(nzBreaks(h(16)), { rest: 4, meal: 2 }); // exactly 16h
});

test("TypeScript agrees with the SQL on the shared cases in nz_breaks.test.sql", () => {
  // The pgTAP test checks nz_breaks() against these same lines.
  const sql = readFileSync(new URL("../../supabase/tests/nz_breaks.test.sql", import.meta.url), "utf8");
  const block = sql.split("-- BREAK CASES START")[1]?.split("-- BREAK CASES END")[0];
  assert.ok(block, "BREAK CASES markers not found in nz_breaks.test.sql");
  const cases = [...block.matchAll(/\((\d+),\s*(\d+),\s*(\d+)\)/g)].map((m) => m.slice(1).map(Number));
  assert.equal(cases.length, 14);
  for (const [minutes, rest, meal] of cases) {
    assert.deepEqual(nzBreaks(minutes), { rest, meal }, `${minutes} minutes`);
  }
});

test("paid minutes take off the unpaid meal breaks", () => {
  assert.equal(paidMinutes(420), 390); // 7h -> 6.5h
  assert.equal(paidMinutes(240), 240); // 4h, no meal break
  assert.equal(paidMinutes(960), 900); // 16h -> 15h
});

test("times and the preview line", () => {
  assert.equal(parseHHMM("09:30"), 570);
  assert.equal(parseHHMM("24:00"), null);
  assert.equal(minutesBetween("09:00", "16:00"), 420);
  assert.equal(minutesBetween("22:00", "02:00"), 240); // past midnight
  assert.equal(minutesBetween("09:00", "09:00"), null);
  assert.equal(minutesBetween("", "17:00"), null);
  assert.equal(hoursText(450), "7.5 h");
  assert.equal(hoursText(480), "8 h");
  assert.equal(breakSummary(420), "7 h at work, 2 x 10 min paid rest, 1 x 30 min meal, 6.5 h paid");
  assert.equal(breakSummary(90), "1.5 h at work, no rest break, no meal break, 1.5 h paid");
});
