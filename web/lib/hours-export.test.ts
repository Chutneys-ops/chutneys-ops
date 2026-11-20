import { test } from "node:test";
import assert from "node:assert/strict";
import { checkExportRange, exportBounds, hoursCsv, hoursFromMinutes } from "./hours-export.ts";

test("hours from minutes", () => {
  assert.equal(hoursFromMinutes(450), "7.50");
  assert.equal(hoursFromMinutes(20), "0.33");
});

test("export range checks and Auckland bounds", () => {
  assert.equal(checkExportRange("2026-11-01", "2026-11-30"), null);
  assert.ok(checkExportRange("2026-11-30", "2026-11-01"));
  assert.ok(checkExportRange("2026-01-01", "2026-12-31")); // too long
  assert.ok(checkExportRange("", "2026-11-30"));
  // November in Auckland is UTC+13.
  assert.deepEqual(exportBounds("2026-11-01", "2026-11-30"), {
    start: "2026-10-31T11:00:00.000Z",
    end: "2026-11-30T11:00:00.000Z",
  });
});

test("hours CSV: timesheets with breaks and paid hours, plus leave, sorted by name then date", () => {
  const csv = hoursCsv(
    [
      {
        name: "Ben",
        site: "Orewa Cafe",
        work_date: "2026-11-20",
        start_time: "09:00:00",
        finish_time: "16:00:00",
        minutes_at_work: 420,
        rest_breaks: 2,
        meal_breaks: 1,
        paid_minutes: 390,
        status: "approved",
        edit_note: null,
      },
      {
        name: "Ana",
        site: "Truck - New Lynn",
        work_date: "2026-11-20",
        start_time: "17:00:00",
        finish_time: "01:30:00", // past midnight
        minutes_at_work: 510,
        rest_breaks: 2,
        meal_breaks: 1,
        paid_minutes: 480,
        status: "submitted",
        edit_note: "Late catering, finished after 1",
      },
      {
        name: "Ana",
        site: "Truck - New Lynn",
        work_date: "2026-11-18",
        start_time: "10:00:00",
        finish_time: "13:00:00",
        minutes_at_work: 180,
        rest_breaks: 1,
        meal_breaks: 0,
        paid_minutes: 180,
        status: "approved",
        edit_note: null,
      },
    ],
    [{ name: "Ana", start_date: "2026-11-20", end_date: "2026-11-21", hours: "16.00", reason: "sick" }],
  );
  assert.equal(
    csv,
    [
      "Name,Site,Date,Start,Finish,At work (h),Rest breaks,Meal breaks,Paid hours,Type,Status,Edit note",
      "Ana,Truck - New Lynn,2026-11-18,10:00,13:00,3.00,1,0,3.00,Hours worked,Approved,",
      'Ana,Truck - New Lynn,2026-11-20,17:00,01:30,8.50,2,1,8.00,Hours worked,Waiting for approval,"Late catering, finished after 1"',
      "Ana,,2026-11-20,2026-11-20,2026-11-21,,,,16.00,Leave: Sick,Approved,",
      "Ben,Orewa Cafe,2026-11-20,09:00,16:00,7.00,2,1,6.50,Hours worked,Approved,",
      "",
    ].join("\r\n"),
  );
});
