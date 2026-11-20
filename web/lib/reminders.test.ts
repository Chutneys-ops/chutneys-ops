import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PREFS,
  KIND_CATEGORY,
  TEST_MESSAGE,
  aucklandMinutes,
  digestText,
  dueReminders,
  isGoneStatus,
  leaveDecidedMessage,
  listText,
  minutesToTime,
  noticeMessage,
  openingTemplateFor,
  peopleAtSiteToday,
  prefsFrom,
  reminderKey,
  rosterMessage,
  safeUrl,
  shiftTomorrowText,
  timeToMinutes,
  tomorrowYmd,
  waitingCounts,
  type ReminderData,
} from "./reminders.ts";

// November is daylight time in Auckland (UTC+13); July is standard (UTC+12).
const nov = (hhmm: string, day = 20) => new Date(`2026-11-${day}T${hhmm}:00+13:00`);
const jul = (hhmm: string) => new Date(`2026-07-15T${hhmm}:00+12:00`);

const ANA = "a0000000-0000-0000-0000-00000000000a"; // staff at Truck 1
const BEN = "b0000000-0000-0000-0000-00000000000b"; // staff at Cafe
const MIA = "c0000000-0000-0000-0000-00000000000c"; // manager
const OLI = "d0000000-0000-0000-0000-00000000000d"; // owner
const TOM = "e0000000-0000-0000-0000-00000000000e"; // turned off
const TRUCK = "10000000-0000-0000-0000-000000000001";
const CAFE = "10000000-0000-0000-0000-000000000002";
const TRUCK2 = "10000000-0000-0000-0000-000000000003"; // nobody there today

function data(overrides: Partial<ReminderData> = {}, now = nov("10:05")): ReminderData {
  const chosen = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(); // 2 hours ago
  return {
    sites: [
      { id: TRUCK, name: "Truck 1", kind: "truck", opens_at: "09:00:00" },
      { id: CAFE, name: "Cafe", kind: "cafe", opens_at: "07:00:00" },
      { id: TRUCK2, name: "Truck 2", kind: "truck", opens_at: "09:00:00" },
    ],
    templates: [
      { code: "fridge_daily", site_kinds: ["truck", "cafe", "restaurant"] },
      { code: "opening_checks_truck", site_kinds: ["truck"] },
      { code: "opening_checks_cafe", site_kinds: ["cafe"] },
      { code: "cooking", site_kinds: ["truck", "cafe", "restaurant"] },
    ],
    doneToday: [],
    choices: [
      { staff_id: ANA, site_id: TRUCK, clock_in: chosen },
      { staff_id: BEN, site_id: CAFE, clock_in: chosen },
      { staff_id: TOM, site_id: TRUCK, clock_in: chosen },
    ],
    people: [
      { id: ANA, name: "Ana", role: "staff", active: true },
      { id: BEN, name: "Ben", role: "staff", active: true },
      { id: MIA, name: "Mia", role: "manager", active: true },
      { id: OLI, name: "Oli", role: "owner", active: true },
      { id: TOM, name: "Tom", role: "staff", active: false },
    ],
    prefs: {},
    subscribed: [ANA, BEN, MIA, OLI, TOM],
    timesheetsWaiting: [],
    leaveWaiting: [],
    tomorrowShifts: [],
    ...overrides,
  };
}

const kinds = (rs: { kind: string; staffId: string }[]) => rs.map((r) => `${r.kind}:${r.staffId}`).sort();

// ---- Clock ----------------------------------------------------------------------

test("aucklandMinutes uses the Auckland wall clock in daylight and standard time", () => {
  assert.equal(aucklandMinutes(nov("10:00")), 600);
  assert.equal(aucklandMinutes(jul("10:00")), 600);
  assert.equal(aucklandMinutes(nov("00:00")), 0);
  assert.equal(aucklandMinutes(nov("23:59")), 23 * 60 + 59);
  // 9 pm UTC on the 19th is 10 am on the 20th in Auckland.
  assert.equal(aucklandMinutes(new Date("2026-11-19T21:00:00Z")), 600);
});

test("timeToMinutes and minutesToTime read Postgres times", () => {
  assert.equal(timeToMinutes("09:00"), 540);
  assert.equal(timeToMinutes("09:30:00"), 570);
  assert.equal(minutesToTime(570), "09:30");
  assert.equal(minutesToTime(0), "00:00");
});

test("tomorrowYmd is tomorrow in Auckland, even when UTC is still on yesterday", () => {
  assert.equal(tomorrowYmd(nov("19:00")), "2026-11-21");
  assert.equal(tomorrowYmd(new Date("2026-11-30T11:30:00Z")), "2026-12-02"); // 00:30 on 1 Dec in Auckland
});

// ---- Keys and switches ---------------------------------------------------------------

test("reminderKey is one per type, Auckland day and person", () => {
  assert.equal(reminderKey("fridge_staff", ANA, "2026-11-20"), `fridge_staff:2026-11-20:${ANA}`);
  assert.notEqual(reminderKey("fridge_staff", ANA, "2026-11-20"), reminderKey("fridge_staff", ANA, "2026-11-21"));
  assert.notEqual(reminderKey("fridge_staff", ANA, "2026-11-20"), reminderKey("opening_checks", ANA, "2026-11-20"));
});

test("prefsFrom: no row means everything on; booleans are kept", () => {
  assert.deepEqual(prefsFrom(null), DEFAULT_PREFS);
  assert.deepEqual(prefsFrom({ roster: false }), { ...DEFAULT_PREFS, roster: false });
  assert.deepEqual(prefsFrom({ notices: null }), DEFAULT_PREFS);
});

test("every reminder type belongs to a switch", () => {
  assert.equal(KIND_CATEGORY.fridge_staff, "reminders");
  assert.equal(KIND_CATEGORY.opening_checks, "reminders");
  assert.equal(KIND_CATEGORY.approvals_digest, "approvals");
  assert.equal(KIND_CATEGORY.shift_tomorrow, "roster");
});

// ---- Who is at a site today --------------------------------------------------------------

test("peopleAtSiteToday: chosen today in Auckland, not yesterday, not stale", () => {
  const now = nov("10:05");
  const choices = [
    { staff_id: ANA, site_id: TRUCK, clock_in: nov("08:00").toISOString() },
    // 11 pm yesterday: still open but it's yesterday's choice.
    { staff_id: BEN, site_id: TRUCK, clock_in: nov("23:00", 19).toISOString() },
    { staff_id: MIA, site_id: CAFE, clock_in: nov("08:00").toISOString() },
  ];
  assert.deepEqual(peopleAtSiteToday(choices, TRUCK, now), [ANA]);
  assert.deepEqual(peopleAtSiteToday(choices, TRUCK2, now), []);
});

test("openingTemplateFor picks the template for the kind of site", () => {
  const t = data().templates;
  assert.equal(openingTemplateFor("truck", t), "opening_checks_truck");
  assert.equal(openingTemplateFor("cafe", t), "opening_checks_cafe");
  assert.equal(openingTemplateFor("restaurant", t), null);
});

// ---- Fridge ---------------------------------------------------------------------------------

test("before 10:00 there is no fridge reminder", () => {
  const rs = dueReminders(nov("09:55"), data({}, nov("09:55")));
  assert.equal(rs.filter((r) => r.kind.startsWith("fridge")).length, 0);
});

test("at 10:00 people at a site without fridge temperatures are reminded, by site", () => {
  const rs = dueReminders(nov("10:00"), data({}, nov("10:00"))).filter((r) => r.kind === "fridge_staff");
  assert.deepEqual(kinds(rs), [`fridge_staff:${ANA}`, `fridge_staff:${BEN}`]);
  const ana = rs.find((r) => r.staffId === ANA)!;
  assert.equal(ana.body, "Fridge temperatures not done yet at Truck 1");
  assert.equal(ana.url, "/records/fridge_daily");
  assert.equal(ana.key, `fridge_staff:2026-11-20:${ANA}`);
  assert.equal(ana.forDate, "2026-11-20");
});

test("a site whose fridge temperatures are done gets no reminder", () => {
  const d = data({ doneToday: [{ site_id: TRUCK, template_code: "fridge_daily" }] });
  const rs = dueReminders(nov("10:05"), d).filter((r) => r.kind === "fridge_staff");
  assert.deepEqual(kinds(rs), [`fridge_staff:${BEN}`]);
});

test("turned-off people, people without a subscription and people who switched reminders off are skipped", () => {
  const d = data({ subscribed: [ANA, MIA, OLI, TOM], prefs: { [ANA]: { ...DEFAULT_PREFS, reminders: false } } });
  const rs = dueReminders(nov("10:05"), d).filter((r) => r.kind === "fridge_staff");
  assert.deepEqual(rs, []); // Ana switched off, Ben has no subscription, Tom is turned off
});

test("managers hear at 11:00 about open sites still missing, not closed ones", () => {
  assert.equal(dueReminders(nov("10:55"), data({}, nov("10:55"))).filter((r) => r.kind === "fridge_manager").length, 0);
  const rs = dueReminders(nov("11:00"), data({}, nov("11:00"))).filter((r) => r.kind === "fridge_manager");
  assert.deepEqual(kinds(rs), [`fridge_manager:${MIA}`, `fridge_manager:${OLI}`]);
  // Truck 2 has nobody there today, so it isn't "missing".
  assert.equal(rs[0].body, "Fridge temperatures not done yet at Truck 1 and Cafe");
});

test("no manager reminder once every open site is done", () => {
  const d = data(
    {
      doneToday: [
        { site_id: TRUCK, template_code: "fridge_daily" },
        { site_id: CAFE, template_code: "fridge_daily" },
      ],
    },
    nov("11:30"),
  );
  assert.equal(dueReminders(nov("11:30"), d).filter((r) => r.kind === "fridge_manager").length, 0);
});

test("fridge reminders stop at 14:00", () => {
  const rs = dueReminders(nov("14:00"), data({}, nov("14:00")));
  assert.equal(rs.filter((r) => r.kind.startsWith("fridge")).length, 0);
});

// ---- Opening checks ----------------------------------------------------------------------------

test("opening checks: 30 minutes after each site's own opening time", () => {
  // Cafe opens 7:00, Truck 1 at 9:00.
  const at0729 = dueReminders(nov("07:29"), data({}, nov("07:29"))).filter((r) => r.kind === "opening_checks");
  assert.equal(at0729.length, 0);
  const at0730 = dueReminders(nov("07:30"), data({}, nov("07:30"))).filter((r) => r.kind === "opening_checks");
  assert.deepEqual(kinds(at0730), [`opening_checks:${BEN}`]);
  assert.equal(at0730[0].body, "Opening checks not done yet at Cafe (opened 7:00 am)");
  assert.equal(at0730[0].url, "/records/opening_checks_cafe");
  const at0930 = dueReminders(nov("09:30"), data({}, nov("09:30"))).filter((r) => r.kind === "opening_checks");
  assert.deepEqual(kinds(at0930), [`opening_checks:${ANA}`, `opening_checks:${BEN}`]);
});

test("opening checks done: no reminder; window closes 3 hours after opening", () => {
  const d = data({ doneToday: [{ site_id: TRUCK, template_code: "opening_checks_truck" }] }, nov("09:30"));
  const rs = dueReminders(nov("09:30"), d).filter((r) => r.kind === "opening_checks");
  assert.deepEqual(kinds(rs), [`opening_checks:${BEN}`]);
  const late = dueReminders(nov("10:00"), data({}, nov("10:00"))).filter((r) => r.staffId === BEN && r.kind === "opening_checks");
  assert.equal(late.length, 0); // Cafe opened 7:00; 10:00 is past its window
});

test("no fridge or opening-check reminders at a site on a day it doesn't trade", () => {
  // 20 Nov 2026 is a Friday. Truck 1 trades Saturday and Sunday only.
  const sites = data().sites.map((s) => (s.id === TRUCK ? { ...s, trading_days: [6, 7] } : s));
  const at1105 = dueReminders(nov("11:05"), data({ sites }, nov("11:05")));
  assert.deepEqual(kinds(at1105.filter((r) => r.kind === "fridge_staff")), [`fridge_staff:${BEN}`]);
  assert.equal(at1105.find((r) => r.kind === "fridge_manager")!.body, "Fridge temperatures not done yet at Cafe");
  const at0930 = dueReminders(nov("09:30"), data({ sites }, nov("09:30"))).filter((r) => r.kind === "opening_checks");
  assert.deepEqual(kinds(at0930), [`opening_checks:${BEN}`]);
  // On Saturday it trades, so Ana is reminded again.
  const sat = dueReminders(nov("10:05", 21), data({ sites }, nov("10:05", 21))).filter((r) => r.kind === "fridge_staff");
  assert.ok(kinds(sat).includes(`fridge_staff:${ANA}`));
});

// ---- 17:00 digest -------------------------------------------------------------------------------

test("waitingCounts: managers don't count their own; the owner counts everything", () => {
  const d = {
    timesheetsWaiting: [{ staff_id: ANA }, { staff_id: MIA }, { staff_id: OLI }],
    leaveWaiting: [{ staff_id: MIA }],
  };
  assert.deepEqual(waitingCounts({ id: MIA, role: "manager" }, d), { timesheets: 2, leave: 0 });
  assert.deepEqual(waitingCounts({ id: OLI, role: "owner" }, d), { timesheets: 3, leave: 1 });
});

test("digestText says singular and plural", () => {
  assert.equal(digestText({ timesheets: 3, leave: 1 }), "3 timesheets and 1 leave request waiting");
  assert.equal(digestText({ timesheets: 1, leave: 0 }), "1 timesheet and 0 leave requests waiting");
});

test("17:00 digest goes to managers with something waiting, never to staff", () => {
  const d = data({ timesheetsWaiting: [{ staff_id: ANA }], leaveWaiting: [{ staff_id: BEN }] }, nov("17:00"));
  assert.equal(dueReminders(nov("16:55"), d).filter((r) => r.kind === "approvals_digest").length, 0);
  const rs = dueReminders(nov("17:00"), d).filter((r) => r.kind === "approvals_digest");
  assert.deepEqual(kinds(rs), [`approvals_digest:${MIA}`, `approvals_digest:${OLI}`]);
  assert.equal(rs[0].body, "1 timesheet and 1 leave request waiting");
  assert.equal(rs[0].url, "/time");
});

test("digest: nothing waiting sends nothing; only leave links to leave requests", () => {
  assert.equal(dueReminders(nov("17:05"), data({}, nov("17:05"))).filter((r) => r.kind === "approvals_digest").length, 0);
  const d = data({ leaveWaiting: [{ staff_id: ANA }] }, nov("17:05"));
  const rs = dueReminders(nov("17:05"), d).filter((r) => r.kind === "approvals_digest");
  assert.equal(rs[0].url, "/leave/requests");
});

test("digest respects the approvals switch", () => {
  const d = data(
    { timesheetsWaiting: [{ staff_id: ANA }], prefs: { [MIA]: { ...DEFAULT_PREFS, approvals: false } } },
    nov("17:05"),
  );
  const rs = dueReminders(nov("17:05"), d).filter((r) => r.kind === "approvals_digest");
  assert.deepEqual(kinds(rs), [`approvals_digest:${OLI}`]);
});

// ---- Evening before a shift -----------------------------------------------------------------------

test("shift tomorrow: from 19:00, one message per person with all their shifts", () => {
  const d = data(
    {
      tomorrowShifts: [
        { staff_id: ANA, site_id: CAFE, start_time: "17:00:00", finish_time: "21:00:00" },
        { staff_id: ANA, site_id: TRUCK, start_time: "09:00:00", finish_time: "13:00:00" },
        { staff_id: BEN, site_id: CAFE, start_time: "09:00:00", finish_time: "17:00:00" },
      ],
    },
    nov("19:00"),
  );
  assert.equal(dueReminders(nov("18:55"), d).filter((r) => r.kind === "shift_tomorrow").length, 0);
  const rs = dueReminders(nov("19:00"), d).filter((r) => r.kind === "shift_tomorrow");
  assert.deepEqual(kinds(rs), [`shift_tomorrow:${ANA}`, `shift_tomorrow:${BEN}`]);
  assert.equal(
    rs.find((r) => r.staffId === ANA)!.body,
    "You're on tomorrow 9:00 am to 1:00 pm at Truck 1 and 5:00 pm to 9:00 pm at Cafe",
  );
  assert.equal(rs.find((r) => r.staffId === BEN)!.body, "You're on tomorrow 9:00 am to 5:00 pm at Cafe");
  assert.equal(dueReminders(nov("22:00"), d).filter((r) => r.kind === "shift_tomorrow").length, 0);
});

test("shiftTomorrowText marks a shift past midnight", () => {
  const names = new Map([[CAFE, "Cafe"]]);
  assert.equal(
    shiftTomorrowText([{ staff_id: ANA, site_id: CAFE, start_time: "18:00:00", finish_time: "02:00:00" }], names),
    "You're on tomorrow 6:00 pm to 2:00 am (next day) at Cafe",
  );
});

test("each person gets each reminder type at most once per run", () => {
  // Ana chose Truck 1 twice today (changed and came back).
  const d = data();
  d.choices.push({ staff_id: ANA, site_id: TRUCK, clock_in: nov("09:30").toISOString() });
  const keys = dueReminders(nov("10:05"), d).map((r) => r.key);
  assert.equal(keys.length, new Set(keys).size);
});

// ---- Messages ---------------------------------------------------------------------------------------

test("event messages", () => {
  assert.deepEqual(noticeMessage({ id: "n1", title: "New menu", needsAck: false }), {
    title: "New notice",
    body: "New menu",
    url: "/notices/n1",
    tag: "notice-n1",
  });
  assert.equal(noticeMessage({ id: "n1", title: "Allergens", needsAck: true }).title, "New notice: please read and confirm");
  assert.equal(
    rosterMessage({ weekStart: "2026-11-23", siteName: "Cafe", republished: false }).body,
    "Your shifts at Cafe for the week of Mon 23 Nov are up.",
  );
  assert.equal(rosterMessage({ weekStart: "2026-11-23", siteName: "Cafe", republished: true }).title, "Your shifts changed");
  assert.equal(
    leaveDecidedMessage({ id: "l1", status: "approved", start_date: "2026-11-20", end_date: "2026-11-20" }).body,
    "Your sick leave for Fri 20 Nov was approved.",
  );
  assert.equal(
    leaveDecidedMessage({ id: "l1", status: "declined", start_date: "2026-11-20", end_date: "2026-11-23" }).body,
    "Your sick leave for Fri 20 Nov to Mon 23 Nov was declined.",
  );
  assert.equal(TEST_MESSAGE.url, "/settings");
});

test("listText", () => {
  assert.equal(listText([]), "");
  assert.equal(listText(["A"]), "A");
  assert.equal(listText(["A", "B"]), "A and B");
  assert.equal(listText(["A", "B", "C"]), "A, B and C");
});

test("isGoneStatus: only 404 and 410 delete a subscription", () => {
  assert.equal(isGoneStatus(404), true);
  assert.equal(isGoneStatus(410), true);
  assert.equal(isGoneStatus(429), false);
  assert.equal(isGoneStatus(500), false);
  assert.equal(isGoneStatus(undefined), false);
});

test("safeUrl only allows our own pages", () => {
  assert.equal(safeUrl("/notices/1"), "/notices/1");
  assert.equal(safeUrl("https://evil.example"), "/home");
  assert.equal(safeUrl("//evil.example"), "/home");
});
