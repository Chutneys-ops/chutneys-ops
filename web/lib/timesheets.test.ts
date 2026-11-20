import { test } from "node:test";
import assert from "node:assert/strict";
import { groupForApproval, hhmm, validateTimesheet, weekLabel, type TimesheetInput } from "./timesheets.ts";

const TODAY = "2026-11-20";
const SITE_A = "00000000-0000-0000-0000-000000000001";
const SITE_B = "00000000-0000-0000-0000-000000000002";
const good: TimesheetInput = {
  work_date: "2026-11-20",
  site_id: SITE_A,
  start_time: "09:00",
  finish_time: "17:00",
  edit_note: "",
};

test("a good timesheet", () => {
  assert.deepEqual(validateTimesheet(good, TODAY, false), {
    values: { work_date: "2026-11-20", site_id: SITE_A, start_time: "09:00", finish_time: "17:00", edit_note: null },
    errors: {},
  });
  // Past midnight is fine.
  assert.deepEqual(validateTimesheet({ ...good, start_time: "22:00", finish_time: "02:00" }, TODAY, false).errors, {});
});

test("timesheet errors", () => {
  assert.ok(validateTimesheet({ ...good, work_date: "2026-11-21" }, TODAY, false).errors.work_date);
  assert.ok(validateTimesheet({ ...good, site_id: "" }, TODAY, false).errors.site_id);
  assert.ok(validateTimesheet({ ...good, finish_time: "09:00" }, TODAY, false).errors.finish_time);
  assert.ok(validateTimesheet({ ...good, start_time: "06:00", finish_time: "23:00" }, TODAY, false).errors.finish_time);
  assert.deepEqual(validateTimesheet({ ...good, start_time: "06:00", finish_time: "22:00" }, TODAY, false).errors, {});
  assert.ok(validateTimesheet({ ...good, start_time: "" }, TODAY, false).errors.start_time);
  // A manager acting for someone needs a note.
  assert.ok(validateTimesheet(good, TODAY, true).errors.edit_note);
  assert.equal(validateTimesheet({ ...good, edit_note: " Paper sheet " }, TODAY, true).values?.edit_note, "Paper sheet");
});

test("grouping for approval: by week and site, newest week first", () => {
  const groups = groupForApproval([
    { id: "1", work_date: "2026-11-18", site_id: SITE_B, site_name: "Orewa Cafe" },
    { id: "2", work_date: "2026-11-10", site_id: SITE_A, site_name: "Chutneys" },
    { id: "3", work_date: "2026-11-16", site_id: SITE_A, site_name: "Chutneys" },
    { id: "4", work_date: "2026-11-17", site_id: SITE_B, site_name: "Orewa Cafe" },
    { id: "5", work_date: "2026-11-22", site_id: SITE_A, site_name: "Chutneys" }, // Sunday: same week
  ]);
  assert.deepEqual(
    groups.map((g) => [g.week, g.siteName, g.rows.map((r) => r.id)]),
    [
      ["2026-11-16", "Chutneys", ["3", "5"]],
      ["2026-11-16", "Orewa Cafe", ["4", "1"]],
      ["2026-11-09", "Chutneys", ["2"]],
    ],
  );
  assert.equal(weekLabel("2026-11-16"), "Week of Mon 16 Nov");
  assert.equal(hhmm("09:30:00"), "09:30");
});
