import { test } from "node:test";
import assert from "node:assert/strict";
import {
  daysInclusive,
  dateRangeText,
  hoursText,
  isYmd,
  parseHours,
  validateLeave,
  type LeaveInput,
} from "./leave.ts";

const TODAY = "2026-11-20";
const base: LeaveInput = {
  start_date: "2026-11-20",
  end_date: "2026-11-21",
  amount: "days",
  hours_per_day: "8",
  hours: "",
  reason: "sick",
  gi_symptoms: "no",
  note: "",
};

test("dates and days", () => {
  assert.equal(isYmd("2026-11-20"), true);
  assert.equal(isYmd("2026-02-30"), false);
  assert.equal(isYmd("20/11/2026"), false);
  assert.equal(daysInclusive("2026-11-20", "2026-11-20"), 1);
  assert.equal(daysInclusive("2026-11-20", "2026-11-22"), 3);
  assert.equal(daysInclusive("2026-11-22", "2026-11-20"), null);
  // Across the start of daylight saving (27 Sep 2026) it's still whole days.
  assert.equal(daysInclusive("2026-09-26", "2026-09-28"), 3);
  assert.equal(dateRangeText("2026-11-20", "2026-11-20"), "Fri 20 Nov");
  assert.equal(dateRangeText("2026-11-20", "2026-11-22"), "Fri 20 Nov to Sun 22 Nov");
});

test("hours", () => {
  assert.equal(parseHours("7.5"), 7.5);
  assert.equal(parseHours("8"), 8);
  assert.equal(parseHours("0"), null);
  assert.equal(parseHours("7.555"), null);
  assert.equal(parseHours("-3"), null);
  assert.equal(hoursText("16.00"), "16 h");
  assert.equal(hoursText(7.5), "7.5 h");
});

test("whole days become hours", () => {
  const { values, errors } = validateLeave(base, TODAY);
  assert.deepEqual(errors, {});
  assert.deepEqual(values, {
    reason: "sick",
    start_date: "2026-11-20",
    end_date: "2026-11-21",
    hours: "16.00",
    gi_symptoms: false,
    note: null,
  });
  assert.equal(validateLeave({ ...base, hours_per_day: "7.5" }, TODAY).values?.hours, "15.00");
});

test("hours mode, and a blank end date means the same day", () => {
  const { values } = validateLeave({ ...base, end_date: "", amount: "hours", hours: "3.5", gi_symptoms: "yes" }, TODAY);
  assert.equal(values?.end_date, "2026-11-20");
  assert.equal(values?.hours, "3.50");
  assert.equal(values?.gi_symptoms, true);
});

test("leave form errors", () => {
  assert.ok(validateLeave({ ...base, end_date: "2026-11-19" }, TODAY).errors.end_date);
  assert.ok(validateLeave({ ...base, end_date: "2027-01-20" }, TODAY).errors.end_date); // over 31 days
  assert.ok(validateLeave({ ...base, start_date: "2027-01-20", end_date: "" }, TODAY).errors.start_date);
  assert.ok(validateLeave({ ...base, gi_symptoms: "" }, TODAY).errors.gi_symptoms);
  assert.ok(validateLeave({ ...base, reason: "holiday" }, TODAY).errors.reason);
  assert.ok(validateLeave({ ...base, amount: "hours", hours: "0" }, TODAY).errors.hours);
  assert.ok(validateLeave({ ...base, hours_per_day: "25" }, TODAY).errors.hours_per_day);
  assert.ok(validateLeave({ ...base, note: "x".repeat(301) }, TODAY).errors.note);
  // Past dates are fine: sick leave is often asked for afterwards.
  assert.deepEqual(validateLeave({ ...base, start_date: "2026-11-02", end_date: "2026-11-02" }, TODAY).errors, {});
});
