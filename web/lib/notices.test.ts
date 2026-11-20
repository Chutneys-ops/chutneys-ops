import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  RECENT_SITE_DAYS,
  audienceFor,
  audienceLabel,
  cleanBody,
  expiryDate,
  expiryFromDate,
  inbox,
  inboxCounts,
  isForSites,
  isLive,
  readStats,
  readStatsText,
  sortNotices,
  validateNotice,
  withMyReads,
  type Notice,
  type NoticeForm,
  type NoticeRead,
  type Person,
} from "./notices.ts";

const NOW = new Date("2026-11-20T01:00:00Z"); // Fri 20 Nov, 2 pm in Auckland
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();
const TRUCK = "s-truck";
const CAFE = "s-cafe";

function notice(partial: Partial<Notice>): Notice {
  return {
    id: "n1",
    title: "Title",
    body: "Body",
    site_ids: null,
    pinned: false,
    needs_ack: false,
    posted_by: "mia",
    posted_at: ago(1),
    expires_at: null,
    edited_at: null,
    archived_at: null,
    ...partial,
  };
}

function read(notice_id: string, staff_id: string, acknowledged = false): NoticeRead {
  return { notice_id, staff_id, read_at: ago(0), acknowledged_at: acknowledged ? ago(0) : null };
}

// ---- Live and audience --------------------------------------------------------------

test("isLive: archived or expired notices are not live", () => {
  assert.equal(isLive(notice({}), NOW), true);
  assert.equal(isLive(notice({ archived_at: ago(1) }), NOW), false);
  assert.equal(isLive(notice({ expires_at: ago(0.01) }), NOW), false);
  assert.equal(isLive(notice({ expires_at: new Date(NOW.getTime() + 1000).toISOString() }), NOW), true);
  assert.equal(isLive(notice({ expires_at: NOW.toISOString() }), NOW), false, "expires exactly now: gone");
});

test("isForSites: everyone, or a shared site", () => {
  assert.equal(isForSites(notice({ site_ids: null }), []), true);
  assert.equal(isForSites(notice({ site_ids: [TRUCK] }), [TRUCK, CAFE]), true);
  assert.equal(isForSites(notice({ site_ids: [TRUCK] }), [CAFE]), false);
  assert.equal(isForSites(notice({ site_ids: [TRUCK] }), []), false);
});

test("sortNotices: pinned first, then newest", () => {
  const sorted = sortNotices([
    notice({ id: "old", posted_at: ago(5) }),
    notice({ id: "pinned-old", pinned: true, posted_at: ago(9) }),
    notice({ id: "new", posted_at: ago(1) }),
    notice({ id: "pinned-new", pinned: true, posted_at: ago(2) }),
  ]);
  assert.deepEqual(
    sorted.map((n) => n.id),
    ["pinned-new", "pinned-old", "new", "old"],
  );
});

test("inbox: live, for you, not your own posts", () => {
  const notices = [
    notice({ id: "everyone" }),
    notice({ id: "truck", site_ids: [TRUCK] }),
    notice({ id: "cafe", site_ids: [CAFE] }),
    notice({ id: "mine", posted_by: "ana" }),
    notice({ id: "archived", archived_at: ago(0) }),
    notice({ id: "expired", expires_at: ago(0.5) }),
  ];
  assert.deepEqual(
    inbox(notices, { id: "ana", recentSiteIds: [TRUCK] }, NOW).map((n) => n.id),
    ["everyone", "truck"],
  );
});

test("withMyReads and inboxCounts", () => {
  const items = withMyReads(
    [
      notice({ id: "a" }),
      notice({ id: "b", needs_ack: true }),
      notice({ id: "c", needs_ack: true }),
      notice({ id: "d" }),
    ],
    [read("b", "ana"), read("c", "ana", true), read("d", "ana")],
  );
  assert.deepEqual(
    items.map((i) => [i.id, i.read, i.acknowledged]),
    [
      ["a", false, false],
      ["b", true, false],
      ["c", true, true],
      ["d", true, false],
    ],
  );
  // a is unread; b is read but still needs acknowledging.
  assert.deepEqual(inboxCounts(items), { unread: 1, toAcknowledge: 1, waiting: 2 });
});

// ---- Read counts ------------------------------------------------------------------------

const people: Person[] = [
  { id: "mia", name: "Mia", active: true }, // manager who posted
  { id: "ana", name: "Ana", active: true },
  { id: "ben", name: "Ben", active: true },
  { id: "cal", name: "Cal", active: true },
  { id: "old", name: "Old Leaver", active: false },
];

test("audienceFor: everyone means active people except the poster", () => {
  assert.deepEqual(
    audienceFor(notice({}), people, [], NOW).map((p) => p.id),
    ["ana", "ben", "cal"],
  );
});

test("audienceFor: a site notice reaches people who chose that site in the last 30 days", () => {
  const choices = [
    { staff_id: "ana", site_id: TRUCK, clock_in: ago(3) },
    { staff_id: "ben", site_id: TRUCK, clock_in: ago(RECENT_SITE_DAYS + 1) }, // too long ago
    { staff_id: "cal", site_id: CAFE, clock_in: ago(1) }, // other site
    { staff_id: "old", site_id: TRUCK, clock_in: ago(1) }, // turned off
    { staff_id: "mia", site_id: TRUCK, clock_in: ago(1) }, // the poster
  ];
  assert.deepEqual(
    audienceFor(notice({ site_ids: [TRUCK] }), people, choices, NOW).map((p) => p.id),
    ["ana"],
  );
  assert.deepEqual(
    audienceFor(notice({ site_ids: [TRUCK, CAFE] }), people, choices, NOW).map((p) => p.id),
    ["ana", "cal"],
  );
});

test("readStats: counts only the audience, lists who hasn't", () => {
  const audience = people.filter((p) => ["ana", "ben", "cal"].includes(p.id));
  const reads = [
    read("n1", "ana", true),
    read("n1", "ben"),
    read("n1", "mia"), // the poster, not in the audience
    read("other", "cal"), // another notice
  ];
  const stats = readStats(notice({ needs_ack: true }), audience, reads);
  assert.equal(stats.total, 3);
  assert.equal(stats.read, 2);
  assert.equal(stats.acknowledged, 1);
  assert.deepEqual(stats.notRead.map((p) => p.name), ["Cal"]);
  assert.deepEqual(stats.notAcknowledged.map((p) => p.name), ["Ben"]);
  assert.equal(readStatsText(stats, true), "Read by 2 of 3, acknowledged by 1");
});

test("readStats: no acknowledgement counts for an ordinary notice", () => {
  const audience = people.slice(1, 3);
  const stats = readStats(notice({}), audience, [read("n1", "ana")]);
  assert.equal(stats.acknowledged, 0);
  assert.deepEqual(stats.notAcknowledged, []);
  assert.equal(readStatsText(stats, false), "Read by 1 of 2");
});

test("audienceLabel", () => {
  assert.equal(audienceLabel(null, {}), "Everyone");
  assert.equal(audienceLabel([TRUCK, CAFE], { [TRUCK]: "Truck", [CAFE]: "Cafe" }), "Truck, Cafe");
  assert.equal(audienceLabel(["gone"], {}), "a closed site");
});

// ---- Expiry ---------------------------------------------------------------------------

test("expiryFromDate: through the end of that Auckland day", () => {
  assert.equal(expiryFromDate("2026-11-25"), "2026-11-26 00:00:00 Pacific/Auckland");
  assert.equal(expiryFromDate("2026-12-31"), "2027-01-01 00:00:00 Pacific/Auckland");
});

test("expiryDate: back to the date shown in the form", () => {
  // 2026-11-26 00:00 in Auckland (NZDT, +13) is 2026-11-25 11:00 UTC.
  assert.equal(expiryDate("2026-11-25T11:00:00+00:00"), "2026-11-25");
  // Winter (NZST, +12): 2026-06-11 00:00 Auckland is 2026-06-10 12:00 UTC.
  assert.equal(expiryDate("2026-06-10T12:00:00+00:00"), "2026-06-10");
});

// ---- Form checks -------------------------------------------------------------------------

const form = (partial: Partial<NoticeForm>): NoticeForm => ({
  title: "Gas bottles",
  body: "New bottles are in the back locker.",
  audience: "everyone",
  site_ids: [],
  pinned: false,
  needs_ack: false,
  expires_on: "",
  ...partial,
});
const TODAY = "2026-11-20";

test("validateNotice: a good notice for everyone", () => {
  const { values, errors } = validateNotice(form({ pinned: true, needs_ack: true }), TODAY, [TRUCK]);
  assert.deepEqual(errors, {});
  assert.deepEqual(values, {
    title: "Gas bottles",
    body: "New bottles are in the back locker.",
    site_ids: null,
    pinned: true,
    needs_ack: true,
    expires_at: null,
  });
});

test("validateNotice: sites, deduplicated, unknown ones dropped", () => {
  const { values } = validateNotice(form({ audience: "sites", site_ids: [TRUCK, TRUCK, "nope"] }), TODAY, [TRUCK, CAFE]);
  assert.deepEqual(values?.site_ids, [TRUCK]);
});

test("validateNotice: errors", () => {
  assert.equal(validateNotice(form({ title: "  " }), TODAY, []).errors.title, "Give it a title");
  assert.match(validateNotice(form({ title: "x".repeat(121) }), TODAY, []).errors.title, /120/);
  assert.equal(validateNotice(form({ body: "" }), TODAY, []).errors.body, "Write the notice");
  assert.match(validateNotice(form({ body: "x".repeat(2001) }), TODAY, []).errors.body, /2000/);
  assert.equal(
    validateNotice(form({ audience: "sites", site_ids: [] }), TODAY, [TRUCK]).errors.site_ids,
    "Choose at least one site",
  );
  assert.equal(validateNotice(form({ audience: "?" }), TODAY, []).errors.audience, "Choose who it's for");
  assert.equal(
    validateNotice(form({ expires_on: "2026-11-19" }), TODAY, []).errors.expires_on,
    "Choose today or a later date",
  );
  assert.equal(validateNotice(form({ expires_on: "soon" }), TODAY, []).errors.expires_on, "Choose a date");
});

test("validateNotice: expiry today is fine and becomes a timestamp", () => {
  const { values } = validateNotice(form({ expires_on: TODAY }), TODAY, []);
  assert.equal(values?.expires_at, "2026-11-21 00:00:00 Pacific/Auckland");
});

test("cleanBody: Windows line breaks become \\n, outer spaces trimmed", () => {
  assert.equal(cleanBody("  Line one\r\nLine two\r\n\r\n"), "Line one\nLine two");
  // A 2000-character body typed in a browser counts the same as the database does.
  const body = `${"x".repeat(999)}\r\n${"y".repeat(1000)}`;
  assert.equal(validateNotice(form({ body }), TODAY, []).errors.body, undefined);
});

// ---- Same rule as the database ------------------------------------------------------------

test("RECENT_SITE_DAYS matches my_recent_site_ids() in the migration", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20261201000000_notices.sql", import.meta.url), "utf8");
  const fn = sql.slice(sql.indexOf("function my_recent_site_ids"));
  assert.match(fn.slice(0, 400), new RegExp(`interval '${RECENT_SITE_DAYS} days'`));
});
