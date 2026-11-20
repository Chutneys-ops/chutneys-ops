import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ALL_DAYS, isoWeekday, isTradingDay, parseTradingDays, tradingDaysText } from "./trading-days.ts";

test("isoWeekday: Monday is 1, Sunday is 7, across daylight saving", () => {
  assert.equal(isoWeekday("2026-11-16"), 1); // Monday
  assert.equal(isoWeekday("2026-11-20"), 5); // Friday
  assert.equal(isoWeekday("2026-11-22"), 7); // Sunday
  assert.equal(isoWeekday("2026-09-27"), 7); // NZ daylight saving starts
  assert.equal(isoWeekday("2026-04-05"), 7); // and ends
});

test("isTradingDay: listed days only; no list means every day", () => {
  const weekdays = [1, 2, 3, 4, 5];
  assert.equal(isTradingDay(weekdays, "2026-11-20"), true);
  assert.equal(isTradingDay(weekdays, "2026-11-21"), false);
  assert.equal(isTradingDay(null, "2026-11-21"), true);
  assert.equal(isTradingDay([], "2026-11-21"), true);
});

test("parseTradingDays sorts, removes repeats and refuses bad input", () => {
  assert.deepEqual(parseTradingDays(["5", "1", "3", "1"]), { days: [1, 3, 5], error: null });
  assert.equal(parseTradingDays([]).error, "Choose at least one trading day");
  assert.equal(parseTradingDays(["0"]).error, "Days must be Monday to Sunday");
  assert.equal(parseTradingDays(["8"]).error, "Days must be Monday to Sunday");
  assert.equal(parseTradingDays(["mon"]).error, "Days must be Monday to Sunday");
});

test("tradingDaysText reads naturally", () => {
  assert.equal(tradingDaysText([1, 2, 3, 4, 5, 6, 7]), "Every day");
  assert.equal(tradingDaysText(null), "Every day");
  assert.equal(tradingDaysText([1, 2, 3, 4, 5]), "Mon to Fri");
  assert.equal(tradingDaysText([3, 4, 5, 6, 7]), "Wed to Sun");
  assert.equal(tradingDaysText([5, 1, 3]), "Mon, Wed and Fri");
  assert.equal(tradingDaysText([6, 7]), "Sat and Sun");
  assert.equal(tradingDaysText([2]), "Tue");
});

test("the default matches the migration (every day)", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20261206000000_trading_days.sql", import.meta.url), "utf8");
  const match = /trading_days smallint\[\] not null default '\{([\d,]+)\}'/.exec(sql);
  assert.ok(match, "default not found in the migration");
  assert.deepEqual(match[1].split(",").map(Number), [...ALL_DAYS]);
});
