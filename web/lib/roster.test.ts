import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  OVER_HOURS_LIMIT,
  addDays,
  clockText,
  compareToRoster,
  differenceTexts,
  durationText,
  groupByDay,
  nextShift,
  rosterTotals,
  shiftTimesText,
  splitWarnings,
  validateShift,
  warningText,
  weekDays,
  weekFromParam,
  weekRangeText,
  weekState,
  type RosterWarning,
  type ShiftInput,
} from "./roster.ts";

const ANA = "00000000-0000-0000-0000-00000000000a";
const BEN = "00000000-0000-0000-0000-00000000000b";
const SITE_A = "10000000-0000-0000-0000-00000000000a";
const SITE_B = "10000000-0000-0000-0000-00000000000b";
const MONDAY = "2026-11-16";

test("week dates", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  // Across the start of daylight saving (27 Sep 2026): no skipped day.
  assert.deepEqual(weekDays("2026-09-21"), [
    "2026-09-21",
    "2026-09-22",
    "2026-09-23",
    "2026-09-24",
    "2026-09-25",
    "2026-09-26",
    "2026-09-27",
  ]);
  assert.equal(weekFromParam("2026-11-20", "2026-01-01"), MONDAY, "any day snaps to its Monday");
  assert.equal(weekFromParam(undefined, "2026-11-22"), MONDAY, "Sunday belongs to the week before");
  assert.equal(weekFromParam("nonsense", "2026-11-18"), MONDAY);
  assert.equal(weekRangeText(MONDAY), "Mon 16 Nov to Sun 22 Nov");
});

const good: ShiftInput = {
  staff_id: ANA,
  work_date: "2026-11-18",
  start_time: "09:00",
  finish_time: "17:00",
  position: " Kitchen ",
  note: "",
};

test("a good shift", () => {
  assert.deepEqual(validateShift(good, MONDAY), {
    values: {
      staff_id: ANA,
      work_date: "2026-11-18",
      start_time: "09:00",
      finish_time: "17:00",
      position: "Kitchen",
      note: null,
    },
    errors: {},
  });
  assert.deepEqual(validateShift({ ...good, start_time: "18:00", finish_time: "01:00" }, MONDAY).errors, {});
});

test("shift errors", () => {
  assert.ok(validateShift({ ...good, staff_id: "" }, MONDAY).errors.staff_id);
  assert.ok(validateShift({ ...good, work_date: "2026-11-23" }, MONDAY).errors.work_date, "the next Monday is outside");
  assert.ok(validateShift({ ...good, work_date: "2026-11-15" }, MONDAY).errors.work_date);
  assert.ok(validateShift({ ...good, start_time: "" }, MONDAY).errors.start_time);
  assert.ok(validateShift({ ...good, finish_time: "09:00" }, MONDAY).errors.finish_time);
  assert.ok(validateShift({ ...good, start_time: "05:00", finish_time: "21:01" }, MONDAY).errors.finish_time);
  assert.deepEqual(validateShift({ ...good, start_time: "05:00", finish_time: "21:00" }, MONDAY).errors, {}, "16 h is fine");
  assert.ok(validateShift({ ...good, position: "x".repeat(41) }, MONDAY).errors.position);
  assert.ok(validateShift({ ...good, note: "x".repeat(201) }, MONDAY).errors.note);
  assert.equal(validateShift({ ...good, staff_id: "" }, MONDAY).values, null);
});

const shift = (staff: string, name: string, date: string, start: string, paid: number, id = `${staff}-${date}-${start}`) => ({
  id,
  staff_id: staff,
  staff_name: name,
  work_date: date,
  start_time: `${start}:00`,
  finish_time: "23:00:00",
  paid_minutes: paid,
});

test("group by day: every day, shifts by start time", () => {
  const days = groupByDay(
    [shift(BEN, "Ben", "2026-11-17", "12:00", 240), shift(ANA, "Ana", "2026-11-17", "09:00", 450), shift(ANA, "Ana", "2026-11-22", "09:00", 450)],
    MONDAY,
  );
  assert.equal(days.length, 7);
  assert.deepEqual(days[0], { date: MONDAY, shifts: [] });
  assert.deepEqual(days[1].shifts.map((s) => s.staff_name), ["Ana", "Ben"]);
  assert.equal(days[6].shifts.length, 1);
});

test("totals per person and for the week", () => {
  const totals = rosterTotals([
    shift(BEN, "Ben", "2026-11-17", "12:00", 240),
    shift(ANA, "Ana", "2026-11-17", "09:00", 450),
    shift(ANA, "Ana", "2026-11-18", "09:00", 330),
  ]);
  assert.deepEqual(totals, {
    people: [
      { staffId: ANA, name: "Ana", paidMinutes: 780, shifts: 2 },
      { staffId: BEN, name: "Ben", paidMinutes: 240, shifts: 1 },
    ],
    paidMinutes: 1020,
  });
  assert.deepEqual(rosterTotals([]), { people: [], paidMinutes: 0 });
});

test("week state", () => {
  assert.equal(weekState(null), "draft");
  assert.equal(weekState({ published_at: null, changed_at: null }), "draft");
  assert.equal(weekState({ published_at: "2026-11-20T01:00:00Z", changed_at: null }), "published");
  assert.equal(weekState({ published_at: "2026-11-20T01:00:00Z", changed_at: "2026-11-20T02:00:00Z" }), "changed");
});

test("warnings: text and split by shift", () => {
  const leave: RosterWarning = { kind: "leave", staff_id: ANA, staff_name: "Ana", work_date: "2026-11-18", shift_id: "s1", paid_minutes: 450 };
  const over: RosterWarning = { kind: "over_hours", staff_id: BEN, staff_name: "Ben", work_date: null, shift_id: null, paid_minutes: 2550 };
  assert.equal(warningText(leave), "Ana is on approved leave on Wed 18 Nov");
  assert.equal(warningText(over), "Ben has 42.5 h paid rostered this week, across all sites (over 40)");
  const { byShift, week } = splitWarnings([over, leave]);
  assert.deepEqual(byShift.get("s1"), [leave]);
  assert.deepEqual(week, [over]);
});

test("the 40-hour limit matches the database", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20261203000000_rosters.sql", import.meta.url), "utf8");
  assert.match(sql, new RegExp(`over_hours_limit constant integer := ${OVER_HOURS_LIMIT};`));
});

test("next shift: the first one not finished yet", () => {
  const shifts = [
    { id: "later", start_at: "2026-11-21T20:00:00Z", finish_at: "2026-11-22T04:00:00Z" },
    { id: "done", start_at: "2026-11-19T20:00:00Z", finish_at: "2026-11-20T04:00:00Z" },
    { id: "now", start_at: "2026-11-20T20:00:00Z", finish_at: "2026-11-21T04:00:00Z" },
  ];
  assert.equal(nextShift(shifts, new Date("2026-11-20T10:00:00Z"))?.id, "now");
  assert.equal(nextShift(shifts, new Date("2026-11-21T01:00:00Z"))?.id, "now", "a shift on now still counts");
  assert.equal(nextShift(shifts, new Date("2026-11-23T00:00:00Z")), null);
});

test("clock and shift times", () => {
  assert.equal(clockText("09:00:00"), "9:00 am");
  assert.equal(clockText("00:30:00"), "12:30 am");
  assert.equal(clockText("12:00:00"), "12:00 pm");
  assert.equal(clockText("17:45"), "5:45 pm");
  assert.equal(shiftTimesText({ start_time: "09:00:00", finish_time: "17:00:00" }), "9:00 am to 5:00 pm");
  assert.equal(shiftTimesText({ start_time: "20:00:00", finish_time: "02:00:00" }), "8:00 pm to 2:00 am (next day)");
});

// Auckland is UTC+13 in November: 9:00 am NZDT = 20:00Z the day before.
const rostered = {
  staff_id: ANA,
  site_id: SITE_A,
  work_date: "2026-11-20",
  start_time: "09:00:00",
  finish_time: "17:00:00",
  start_at: "2026-11-19T20:00:00+00:00",
  finish_at: "2026-11-20T04:00:00+00:00",
};
const sheet = { staff_id: ANA, site_id: SITE_A, work_date: "2026-11-20", start_at: rostered.start_at, finish_at: rostered.finish_at };
const at = (iso: string, minutes: number) => new Date(Date.parse(iso) + minutes * 60_000).toISOString();

test("timesheet vs roster: matches within 15 minutes", () => {
  assert.equal(compareToRoster(sheet, [rostered]).status, "matches");
  const close = { ...sheet, start_at: at(rostered.start_at, 15), finish_at: at(rostered.finish_at, -15) };
  assert.equal(compareToRoster(close, [rostered]).status, "matches", "exactly 15 minutes is not flagged");
});

test("timesheet vs roster: differences over 15 minutes", () => {
  const late = { ...sheet, start_at: at(rostered.start_at, 16) };
  const c = compareToRoster(late, [rostered]);
  assert.equal(c.status, "differs");
  assert.deepEqual(differenceTexts(c), ["Started 16 min late"]);

  const longer = { ...sheet, start_at: at(rostered.start_at, -30), finish_at: at(rostered.finish_at, 75) };
  assert.deepEqual(differenceTexts(compareToRoster(longer, [rostered])), ["Started 30 min early", "Finished 1 h 15 min late"]);

  const short = { ...sheet, finish_at: at(rostered.finish_at, -120) };
  assert.deepEqual(differenceTexts(compareToRoster(short, [rostered])), ["Finished 2 h early"]);
  assert.deepEqual(differenceTexts(compareToRoster(sheet, [rostered])), []);
});

test("timesheet vs roster: not rostered", () => {
  assert.equal(compareToRoster(sheet, []).status, "not_rostered");
  assert.equal(compareToRoster({ ...sheet, site_id: SITE_B }, [rostered]).status, "not_rostered", "other site");
  assert.equal(compareToRoster({ ...sheet, staff_id: BEN }, [rostered]).status, "not_rostered", "other person");
  assert.equal(compareToRoster({ ...sheet, work_date: "2026-11-21" }, [rostered]).status, "not_rostered", "other day");
});

test("timesheet vs roster: split shifts use the closest start", () => {
  const evening = {
    ...rostered,
    start_time: "17:00:00",
    finish_time: "21:00:00",
    start_at: "2026-11-20T04:00:00+00:00",
    finish_at: "2026-11-20T08:00:00+00:00",
  };
  const morning = { ...rostered, finish_time: "12:00:00", finish_at: "2026-11-19T23:00:00+00:00" };
  const eveningSheet = { ...sheet, start_at: evening.start_at, finish_at: evening.finish_at };
  const c = compareToRoster(eveningSheet, [morning, evening]);
  assert.equal(c.status, "matches");
  assert.equal(c.status === "matches" && c.shift.start_time, "17:00:00");
});

test("durations", () => {
  assert.equal(durationText(20), "20 min");
  assert.equal(durationText(-60), "1 h");
  assert.equal(durationText(135), "2 h 15 min");
});
