import { test } from "node:test";
import assert from "node:assert/strict";
import { countCards, dueToday, firstName, greeting, sumPurchases, type TemplateLite } from "./home.ts";

test("greeting by Auckland time of day", () => {
  // November is UTC+13: 20:00 UTC is 9 am the next day in Auckland.
  assert.equal(greeting(new Date("2026-11-19T20:00:00Z")), "Good morning"); // 9:00
  assert.equal(greeting(new Date("2026-11-19T16:00:00Z")), "Good morning"); // 5:00
  assert.equal(greeting(new Date("2026-11-19T15:59:00Z")), "Good evening"); // 4:59
  assert.equal(greeting(new Date("2026-11-19T23:00:00Z")), "Good afternoon"); // 12:00
  assert.equal(greeting(new Date("2026-11-20T03:59:00Z")), "Good afternoon"); // 16:59
  assert.equal(greeting(new Date("2026-11-20T04:00:00Z")), "Good evening"); // 17:00
  // July is UTC+12: 21:00 UTC is 9 am.
  assert.equal(greeting(new Date("2026-07-01T21:00:00Z")), "Good morning");
  assert.equal(firstName("Ana Patel"), "Ana");
  assert.equal(firstName("  Mia "), "Mia");
});

test("due today: only required-every-day records with no entries yet", () => {
  const templates: TemplateLite[] = [
    { code: "opening_checks_truck", title: "Opening checks", required_daily: true },
    { code: "fridge_daily", title: "Fridge temperatures", required_daily: true },
    { code: "cooking", title: "Cooking", required_daily: false }, // daily, but only when something is cooked
    { code: "cleaning", title: "Cleaning", required_daily: true },
    { code: "deliveries", title: "Deliveries", required_daily: false },
  ];
  assert.deepEqual(
    dueToday(templates, [
      { template_code: "fridge_daily", entry_count: 2 },
      { template_code: "cleaning", entry_count: 0 }, // started but empty: still due
    ]).map((t) => t.title),
    ["Opening checks", "Cleaning"],
  );
  assert.deepEqual(
    dueToday(templates, [
      { template_code: "opening_checks_truck", entry_count: 1 },
      { template_code: "fridge_daily", entry_count: 1 },
      { template_code: "cleaning", entry_count: 3 },
    ]),
    [],
  );
});

test("count cards: zero cards hidden, food safety first, plurals", () => {
  const none = { timesheetsToApprove: 0, leaveWaiting: 0, outOfRangeToday: 0, notSignedOffToday: 0, staffToClear: 0 };
  assert.deepEqual(countCards(none), []);
  const cards = countCards({ ...none, timesheetsToApprove: 3, staffToClear: 1, outOfRangeToday: 2 });
  assert.deepEqual(
    cards.map((c) => [c.text, c.href, c.urgent]),
    [
      ["1 person to clear after illness", "/leave/sickness", true],
      ["2 out-of-range readings today", "/records", true],
      ["3 timesheets to approve", "/time", false],
    ],
  );
  assert.equal(countCards({ ...none, leaveWaiting: 1 })[0].text, "1 leave request waiting");
  assert.equal(countCards({ ...none, notSignedOffToday: 4 })[0].text, "4 sheets not signed off today");
});

test("purchases this month: total and GST in cents", () => {
  assert.deepEqual(
    sumPurchases([
      { total_incl_gst: "115.00", gst_amount: "15.00" },
      { total_incl_gst: 0.1, gst_amount: 0.01 },
      { total_incl_gst: "0.20", gst_amount: "0.03" },
    ]),
    { count: 3, totalCents: 11530, gstCents: 1504 },
  );
  assert.deepEqual(sumPurchases([]), { count: 0, totalCents: 0, gstCents: 0 });
});
