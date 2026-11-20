import { test } from "node:test";
import assert from "node:assert/strict";
import { checkExportRange, exportBounds, hoursCsv, shiftHours } from "./hours-export.ts";

test("shift hours", () => {
  assert.equal(shiftHours("2026-11-19T20:00:00Z", "2026-11-20T04:30:00Z"), 8.5);
  assert.equal(shiftHours("2026-11-19T20:00:00Z", "2026-11-19T20:20:00Z"), 0.33);
  assert.equal(shiftHours("2026-11-19T20:00:00Z", null), null);
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

test("hours CSV: shifts and leave, sorted by name then date", () => {
  const csv = hoursCsv(
    [
      {
        name: "Ben",
        site: "Orewa Cafe",
        clock_in: "2026-11-19T20:00:00Z", // 09:00 on Fri 20 Nov in Auckland
        clock_out: "2026-11-20T04:30:00Z", // 17:30
        needs_review: false,
        edit_note: null,
      },
      {
        name: "Ana",
        site: "Truck - New Lynn",
        clock_in: "2026-11-18T21:15:00Z",
        clock_out: "2026-11-18T21:15:00Z",
        needs_review: true,
        edit_note: null,
      },
      {
        name: "Ana",
        site: "Truck - New Lynn",
        clock_in: "2026-11-19T21:00:00Z",
        clock_out: "2026-11-20T03:00:00Z",
        needs_review: false,
        edit_note: "Forgot to clock out, left at 4 pm",
      },
      {
        name: "Ana",
        site: "Truck - New Lynn",
        clock_in: "2026-11-20T22:00:00Z",
        clock_out: null,
        needs_review: false,
        edit_note: null,
      },
    ],
    [{ name: "Ana", start_date: "2026-11-20", end_date: "2026-11-21", hours: "16.00", reason: "sick" }],
  );
  assert.equal(
    csv,
    [
      "Name,Site,Date,Start,End,Hours,Type,Edit note",
      "Ana,Truck - New Lynn,2026-11-19,10:15,10:15,0.00,Shift (needs review),",
      'Ana,Truck - New Lynn,2026-11-20,10:00,16:00,6.00,Shift,"Forgot to clock out, left at 4 pm"',
      "Ana,,2026-11-20,2026-11-20,2026-11-21,16.00,Leave: Sick,",
      "Ana,Truck - New Lynn,2026-11-21,11:00,,,Shift (still open),",
      "Ben,Orewa Cafe,2026-11-20,09:00,17:30,8.50,Shift,",
      "",
    ].join("\r\n"),
  );
});
