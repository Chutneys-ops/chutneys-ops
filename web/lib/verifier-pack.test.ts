import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildPack,
  CONTENTS_PER_PAGE,
  contentsItems,
  contentsPages,
  countsNote,
  datesInRange,
  dayCount,
  expectedDays,
  findGaps,
  firstBodyPage,
  longDate,
  monthBounds,
  monthFromPackPath,
  monthLabel,
  monthlyPackPath,
  PACK_BUCKET,
  packFileName,
  packSummary,
  packTotals,
  pageRefs,
  previousMonth,
  rangeError,
  rangeLabel,
  sameMarkers,
  sheetRows,
  sicknessRows,
  trainingByPerson,
  type PackEntry,
  type PackInput,
  type PackSite,
  type PackTemplate,
} from "./verifier-pack.ts";

// ---- Fixtures ------------------------------------------------------------------

const truck: PackSite = { id: "s-truck", name: "Truck 1", kind: "truck", active: true, created_at: "2026-01-01T00:00:00Z", trading_days: null };
const cafe: PackSite = { id: "s-cafe", name: "Cafe", kind: "cafe", active: true, created_at: "2026-01-01T00:00:00Z", trading_days: [1, 2, 3, 4, 5, 6, 7] };

const fridge: PackTemplate = {
  code: "fridge_daily",
  title: "Fridge temperatures",
  period: "daily",
  required_daily: true,
  site_kinds: ["restaurant", "cafe", "truck"],
  sort_order: 1,
  active: true,
  fields: [
    { key: "unit", label: "Fridge, chiller or freezer", type: "temp_unit", required: true },
    { key: "temperature", label: "Temperature", type: "number", required: true, max: 5, unit: "C", range_from: "unit" },
  ],
};
const cooling: PackTemplate = {
  code: "cooling",
  title: "Cooling",
  period: "daily",
  required_daily: false,
  site_kinds: ["restaurant", "cafe", "truck"],
  sort_order: 3,
  active: true,
  fields: [
    { key: "dish", label: "Dish", type: "text", required: true },
    { key: "temp_2h", label: "Temperature after 2 hours", type: "number", max: 21, unit: "C", later: true },
  ],
};
const deliveries: PackTemplate = {
  code: "deliveries",
  title: "Deliveries",
  period: "event",
  required_daily: false,
  site_kinds: ["restaurant", "cafe", "truck"],
  sort_order: 10,
  active: true,
  fields: [
    { key: "supplier", label: "Supplier", type: "text", required: true },
    { key: "arrival_temp", label: "Arrival temperature", type: "number", max: 5, unit: "C" },
  ],
};
const openingTruck: PackTemplate = {
  code: "opening_checks_truck",
  title: "Opening checks",
  period: "daily",
  required_daily: true,
  site_kinds: ["truck"],
  sort_order: 0,
  active: true,
  fields: [{ key: "gas", label: "Gas bottles checked", type: "yes_no", required: true, expect: true }],
};

const units = [{ id: "u-freezer", site_id: "s-truck", name: "Freezer", min_c: -25, max_c: -15 }];

// 10:00 am NZDT on 2 Nov 2026 = 21:00 UTC on 1 Nov.
function entry(id: string, sheet: string, at: string, values: PackEntry["values"], extra: Partial<PackEntry> = {}): PackEntry {
  return {
    id,
    sheet_id: sheet,
    recorded_at: at,
    values,
    amends_entry_id: null,
    continues_entry_id: null,
    out_of_range: false,
    corrective_action: null,
    note: null,
    recorder: { name: "Ana" },
    ...extra,
  };
}

function input(overrides: Partial<PackInput> = {}): PackInput {
  return {
    from: "2026-11-01",
    to: "2026-11-03",
    siteId: null,
    sites: [truck],
    templates: [fridge, cooling, deliveries, openingTruck],
    sheets: [],
    entries: [],
    units,
    siteDays: [],
    sickness: [],
    workers: [],
    training: [],
    ...overrides,
  };
}

// ---- Ranges and months ------------------------------------------------------------

test("datesInRange includes both ends and crosses daylight saving cleanly", () => {
  assert.deepEqual(datesInRange("2026-09-26", "2026-09-28"), ["2026-09-26", "2026-09-27", "2026-09-28"]);
  assert.deepEqual(datesInRange("2026-11-03", "2026-11-03"), ["2026-11-03"]);
  assert.deepEqual(datesInRange("2026-11-04", "2026-11-03"), []);
  assert.equal(dayCount("2026-10-01", "2026-12-31"), 92);
});

test("rangeError checks dates, order, the future and the length", () => {
  const today = "2026-11-20";
  assert.equal(rangeError("2026-11-01", "2026-11-20", today), null);
  assert.match(rangeError("2026-11-01", undefined, today)!, /start and end/);
  assert.match(rangeError("2026-02-30", "2026-03-01", today)!, /start and end/);
  assert.match(rangeError("2026-11-10", "2026-11-01", today)!, /on or before/);
  assert.match(rangeError("2026-11-01", "2026-11-21", today)!, /future/);
  assert.equal(rangeError("2026-08-21", "2026-11-20", today), null); // exactly 92 days
  assert.match(rangeError("2026-08-20", "2026-11-20", today)!, /92 days or fewer/);
});

test("previousMonth, monthBounds and labels", () => {
  assert.equal(previousMonth("2026-11-01"), "2026-10");
  assert.equal(previousMonth("2027-01-01"), "2026-12");
  assert.deepEqual(monthBounds("2026-10"), { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(monthBounds("2028-02"), { from: "2028-02-01", to: "2028-02-29" });
  assert.equal(monthLabel("2026-10"), "October 2026");
  assert.equal(longDate("2026-11-20"), "Friday 20 November 2026");
  assert.equal(rangeLabel("2026-10-01", "2026-10-31"), "1 Oct 2026 to 31 Oct 2026");
  assert.equal(rangeLabel("2026-10-01", "2026-10-01"), "1 Oct 2026");
});

test("monthly copies live in a year folder, and only real copy paths are accepted", () => {
  assert.equal(monthlyPackPath("2026-10"), "2026/2026-10.pdf");
  assert.equal(monthFromPackPath("2026/2026-10.pdf"), "2026-10");
  assert.equal(monthFromPackPath("2025/2026-10.pdf"), null);
  assert.equal(monthFromPackPath("2026/2026-13.pdf"), null);
  assert.equal(monthFromPackPath("../invoices/x.pdf"), null);
  assert.equal(monthFromPackPath("2026/2026-10.pdf.exe"), null);
});

test("packFileName is safe for downloads", () => {
  assert.equal(packFileName(null, "2026-10-01", "2026-10-31"), "verifier-pack-all-sites-2026-10-01-to-2026-10-31.pdf");
  assert.equal(packFileName("Māngere Truck #2", "2026-11-01", "2026-11-02"), "verifier-pack-mangere-truck-2-2026-11-01-to-2026-11-02.pdf");
});

test("the bucket name matches the migration", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20261205000000_verifier_packs.sql", import.meta.url), "utf8");
  assert.ok(sql.includes(`'${PACK_BUCKET}'`));
});

// ---- Grouping -------------------------------------------------------------------------

test("sheetRows puts corrections and later readings under their entry, in order", () => {
  const rows = sheetRows(
    [
      entry("e2", "sh", "2026-11-01T23:00:00Z", { dish: "Dal" }), // 12:00 pm
      entry("c1", "sh", "2026-11-01T22:00:00Z", { dish: "Chicken curry" }, { amends_entry_id: "e1", note: "Wrong dish" }),
      entry("e1", "sh", "2026-11-01T21:00:00Z", { dish: "Chiken" }), // 10:00 am
      entry("f1", "sh", "2026-11-02T01:00:00Z", { temp_2h: 25 }, {
        continues_entry_id: "e1",
        out_of_range: true,
        corrective_action: "Moved to blast chiller",
      }),
    ],
    cooling.fields,
  );
  assert.deepEqual(
    rows.map((r) => [r.id, r.kind, r.relation]),
    [
      ["e1", "entry", null],
      ["c1", "correction", "Correction of the 10:00 am entry"],
      ["f1", "later", "Later reading for the 10:00 am entry"],
      ["e2", "entry", null],
    ],
  );
  const later = rows[2];
  assert.equal(later.outOfRange, true);
  assert.equal(later.correctiveAction, "Moved to blast chiller");
  assert.deepEqual(later.values, [{ label: "Temperature after 2 hours", text: "25 °C", out: true }]);
  assert.equal(rows[1].comment, "Wrong dish");
  assert.equal(rows[0].by, "Ana");
  assert.equal(rows[0].time, "10:00 am");
});

test("values show units and unit names, and use each unit's own limits", () => {
  const [row] = sheetRows(
    [entry("e1", "sh", "2026-11-01T21:00:00Z", { unit: "u-freezer", temperature: -18 })],
    fridge.fields,
    units,
  );
  assert.deepEqual(row.values, [
    { label: "Fridge, chiller or freezer", text: "Freezer", out: false },
    { label: "Temperature", text: "-18 °C", out: false },
  ]);
  assert.equal(row.outOfRange, false);
  const [warm] = sheetRows(
    [entry("e2", "sh", "2026-11-01T21:00:00Z", { unit: "u-freezer", temperature: -5 }, { out_of_range: true, corrective_action: "Moved stock" })],
    fridge.fields,
    units,
  );
  assert.equal(warm.values[1].out, true);
  assert.equal(warm.outOfRange, true);
});

test("the database's out-of-range flag wins even if limits changed since", () => {
  const [row] = sheetRows(
    [entry("e1", "sh", "2026-11-01T21:00:00Z", { dish: "Dal" }, { out_of_range: true, corrective_action: "Binned" })],
    cooling.fields,
  );
  assert.equal(row.outOfRange, true);
});

// ---- Gaps --------------------------------------------------------------------------------

test("expectedDays starts on the day the site was added, in Auckland time", () => {
  // 11:30 UTC on 1 Nov is 00:30 on 2 Nov in Auckland.
  assert.deepEqual(expectedDays({ created_at: "2026-11-01T11:30:00Z" }, "2026-11-01", "2026-11-03"), ["2026-11-02", "2026-11-03"]);
  assert.deepEqual(findGaps(["2026-11-01", "2026-11-02", "2026-11-03"], ["2026-11-02"]), ["2026-11-01", "2026-11-03"]);
});

test("buildPack lists required records on every day, with No record where nothing was done", () => {
  const pack = buildPack(
    input({
      sheets: [
        { id: "sh1", site_id: "s-truck", template_code: "fridge_daily", sheet_date: "2026-11-02", signed_off_at: "2026-11-02T06:00:00Z", signer: { name: "Mia" } },
      ],
      entries: [entry("e1", "sh1", "2026-11-01T21:00:00Z", { unit: "u-freezer", temperature: -18 })],
      siteDays: [{ site_id: "s-truck", date: "2026-11-03" }],
    }),
  );
  assert.equal(pack.parts.length, 1);
  const [opening, fridgeSection] = pack.parts[0].sections;
  // Opening checks (sort order 0) come before fridge temperatures (1).
  assert.equal(opening.code, "opening_checks_truck");
  assert.equal(opening.counts.missingDays, 3);
  assert.equal(fridgeSection.code, "fridge_daily");
  assert.deepEqual(
    fridgeSection.days.map((d) => (d.status === "missing" ? `${d.date} missing ${d.siteUsed ? "used" : "unused"}` : `${d.date} ok`)),
    ["2026-11-01 missing unused", "2026-11-02 ok", "2026-11-03 missing used"],
  );
  const recorded = fridgeSection.days[1];
  assert.ok(recorded.status === "recorded" && recorded.signedOff?.by === "Mia");
  assert.deepEqual(fridgeSection.counts, { entries: 1, outOfRange: 0, missingDays: 2, closedDays: 0, unsignedDays: 0 });
  // Cooling and deliveries had nothing and aren't required: not in the pack.
  assert.equal(pack.parts[0].sections.length, 2);
});

test("records only done when something happens appear only on days they were done, events last", () => {
  const pack = buildPack(
    input({
      sites: [cafe],
      sheets: [
        { id: "d1", site_id: "s-cafe", template_code: "deliveries", sheet_date: "2026-11-01", signed_off_at: null, signer: null },
        { id: "c1", site_id: "s-cafe", template_code: "cooling", sheet_date: "2026-11-02", signed_off_at: null, signer: null },
        // A sheet outside the range is ignored.
        { id: "c0", site_id: "s-cafe", template_code: "cooling", sheet_date: "2026-10-31", signed_off_at: null, signer: null },
      ],
      entries: [
        entry("x1", "d1", "2026-10-31T20:00:00Z", { supplier: "Gilmours", arrival_temp: 8 }, { out_of_range: true, corrective_action: "Rejected" }),
        entry("x2", "c1", "2026-11-01T20:00:00Z", { dish: "Rice" }),
        entry("x0", "c0", "2026-10-30T20:00:00Z", { dish: "Old" }),
      ],
    }),
  );
  const codes = pack.parts[0].sections.map((s) => s.code);
  assert.deepEqual(codes, ["fridge_daily", "cooling", "deliveries"]);
  const deliveriesSection = pack.parts[0].sections[2];
  assert.equal(deliveriesSection.title, "Supplier deliveries");
  assert.equal(deliveriesSection.days.length, 1);
  assert.deepEqual(deliveriesSection.counts, { entries: 1, outOfRange: 1, missingDays: 0, closedDays: 0, unsignedDays: 1 });
  assert.deepEqual(packTotals(pack), { entries: 2, outOfRange: 1, missingDays: 3, closedDays: 0, unsignedDays: 2 });
});

test("a sheet with no entries counts as No record", () => {
  const pack = buildPack(
    input({
      to: "2026-11-01",
      templates: [fridge],
      sheets: [{ id: "sh1", site_id: "s-truck", template_code: "fridge_daily", sheet_date: "2026-11-01", signed_off_at: null, signer: null }],
    }),
  );
  assert.equal(pack.parts[0].sections[0].days[0].status, "missing");
});

test("closed sites appear only with records; one-site packs show only that site", () => {
  const closed: PackSite = { ...cafe, id: "s-old", name: "Old cart", active: false };
  const base = input({ sites: [truck, closed], templates: [fridge] });
  assert.deepEqual(buildPack(base).parts.map((p) => p.site.name), ["Truck 1"]);

  const withRecord = buildPack({
    ...base,
    sheets: [{ id: "o1", site_id: "s-old", template_code: "fridge_daily", sheet_date: "2026-11-01", signed_off_at: null, signer: null }],
    entries: [entry("e", "o1", "2026-10-31T20:00:00Z", { unit: "x", temperature: 3 })],
  });
  assert.deepEqual(withRecord.parts.map((p) => p.site.name), ["Old cart", "Truck 1"]);
  // A closed site isn't expected to keep records: no gaps listed for it.
  assert.equal(withRecord.parts[0].sections[0].days.length, 1);

  // A site added after the range has nothing to show.
  const newSite: PackSite = { ...truck, id: "s-new", name: "New truck", created_at: "2026-12-01T00:00:00Z" };
  assert.deepEqual(buildPack({ ...base, sites: [truck, newSite] }).parts.map((p) => p.site.name), ["Truck 1"]);

  const onlyTruck = buildPack({ ...base, siteId: "s-truck" });
  assert.equal(onlyTruck.allSites, false);
  assert.deepEqual(onlyTruck.parts.map((p) => p.site.id), ["s-truck"]);
});

// ---- Sickness and training -------------------------------------------------------------------

test("sickness rows overlap the range and carry no medical details", () => {
  const rows = sicknessRows(
    [
      { start_date: "2026-10-20", cleared_to_work_at: "2026-10-25T01:00:00Z", person: { name: "Old" }, clearer: { name: "Mia" } },
      { start_date: "2026-10-28", cleared_to_work_at: "2026-11-01T01:00:00Z", person: { name: "Ben" }, clearer: { name: "Mia" } },
      { start_date: "2026-11-02", cleared_to_work_at: null, person: { name: "Ana" }, clearer: null },
      { start_date: "2026-11-05", cleared_to_work_at: null, person: { name: "Later" }, clearer: null },
    ],
    "2026-11-01",
    "2026-11-03",
  );
  assert.deepEqual(rows, [
    { name: "Ben", dateSick: "2026-10-28", dateCleared: "2026-11-01", clearedBy: "Mia" },
    { name: "Ana", dateSick: "2026-11-02", dateCleared: null, clearedBy: null },
  ]);
  assert.deepEqual(Object.keys(rows[0]).sort(), ["clearedBy", "dateCleared", "dateSick", "name"]);
});

test("training: everyone who worked, all their training up to the end date, people with none too", () => {
  const record = (trainee_id: string, topic: string, trained_on: string, confirmed: boolean) => ({
    trainee_id,
    topic,
    topic_detail: topic === "other" ? "Fire blanket" : null,
    trained_on,
    trainer_signed_at: `${trained_on}T01:00:00Z`,
    trainee_signed_at: confirmed ? `${trained_on}T02:00:00Z` : null,
    trainee: null,
    trainer: { name: "Mia" },
  });
  const people = trainingByPerson(
    [
      { id: "ben", name: "Ben" },
      { id: "ana", name: "Ana" },
      { id: "cy", name: "Cy" },
      { id: "ana", name: "Ana" }, // chose a site and had a timesheet: listed once
    ],
    [
      record("ana", "allergens", "2025-03-01", true), // long before the range: still listed
      record("ana", "other", "2026-11-02", false),
      record("ana", "cleaning", "2026-12-01", true), // after the range: not listed
      record("ben", "induction", "2026-10-01", true),
      record("zed", "allergens", "2026-11-01", true), // didn't work in the range
    ],
    "2026-11-03",
  );
  assert.deepEqual(
    people.map((p) => [p.name, p.records.map((r) => `${r.date} ${r.topic}${r.traineeSignedAt ? "" : " (unconfirmed)"}`)]),
    [
      ["Ana", ["2025-03-01 Allergens", "2026-11-02 Other: Fire blanket (unconfirmed)"]],
      ["Ben", ["2026-10-01 Induction"]],
      ["Cy", []],
    ],
  );
  assert.equal(people[0].records[0].trainer, "Mia");
});

test("buildPack passes workers and training through to the pack", () => {
  const pack = buildPack(
    input({
      templates: [fridge],
      workers: [{ id: "ana", name: "Ana" }],
      training: [
        {
          trainee_id: "ana",
          topic: "allergens",
          topic_detail: null,
          trained_on: "2024-01-01",
          trainer_signed_at: "2024-01-01T01:00:00Z",
          trainee_signed_at: null,
          trainee: { name: "Ana" },
          trainer: { name: "Mia" },
        },
      ],
    }),
  );
  assert.equal(pack.training.length, 1);
  assert.equal(pack.training[0].records[0].topic, "Allergens");
  assert.equal(contentsItems(pack).at(-1)!.note, "1 person · 1 record");
});

// ---- Trading days --------------------------------------------------------------------------

test("findGaps skips days the site doesn't trade", () => {
  // 2026-11-20 is a Friday, 21 Saturday, 22 Sunday.
  const days = ["2026-11-20", "2026-11-21", "2026-11-22"];
  assert.deepEqual(findGaps(days, [], [1, 2, 3, 4, 5]), ["2026-11-20"]);
  assert.deepEqual(findGaps(days, [], null), days);
  assert.deepEqual(findGaps(days, ["2026-11-20"], [1, 2, 3, 4, 5]), []);
});

test("buildPack shows Closed on non-trading days, never as a gap, and entries on them still count", () => {
  const weekdaysTruck: PackSite = { ...truck, trading_days: [1, 2, 3, 4, 5] };
  const pack = buildPack(
    input({
      from: "2026-11-20", // Friday
      to: "2026-11-23", // Monday
      sites: [weekdaysTruck],
      templates: [fridge],
      sheets: [
        // Someone did the fridge check on Sunday anyway.
        { id: "sun", site_id: "s-truck", template_code: "fridge_daily", sheet_date: "2026-11-22", signed_off_at: null, signer: null },
      ],
      entries: [entry("e1", "sun", "2026-11-21T20:00:00Z", { unit: "u-freezer", temperature: -18 })],
    }),
  );
  const section = pack.parts[0].sections[0];
  assert.deepEqual(
    section.days.map((d) => `${d.date} ${d.status}`),
    ["2026-11-20 missing", "2026-11-21 closed", "2026-11-22 recorded", "2026-11-23 missing"],
  );
  assert.deepEqual(section.counts, { entries: 1, outOfRange: 0, missingDays: 2, closedDays: 1, unsignedDays: 1 });
  assert.equal(countsNote(section.counts), "1 entry · 2 days with no record · 1 closed");
  assert.deepEqual(packSummary(pack)[0].missing, [{ title: "Fridge temperatures", days: 2 }]);
});

// ---- Page planning ----------------------------------------------------------------------------

test("contents list sites, their sections, then sickness and training", () => {
  const pack = buildPack(input({ templates: [fridge] }));
  const items = contentsItems(pack);
  assert.deepEqual(items.map((i) => [i.level, i.title]), [
    [0, "Truck 1"],
    [1, "Fridge temperatures"],
    [0, "Staff sickness (food safety exclusions)"],
    [0, "Training records"],
  ]);
  assert.equal(items[1].note, "0 entries · 3 days with no record");
  assert.equal(countsNote({ entries: 1, outOfRange: 1, missingDays: 1, closedDays: 0, unsignedDays: 0 }), "1 entry · 1 out of range · 1 day with no record");
});

test("contents pages: always at least one, split by CONTENTS_PER_PAGE", () => {
  assert.deepEqual(contentsPages([]), [[]]);
  assert.equal(contentsPages(new Array(CONTENTS_PER_PAGE).fill(0)).length, 1);
  assert.equal(contentsPages(new Array(CONTENTS_PER_PAGE + 1).fill(0)).length, 2);
  assert.equal(firstBodyPage(4), 3); // cover, one contents page, then records
  assert.equal(firstBodyPage(CONTENTS_PER_PAGE * 2 + 1), 5);
});

test("pageRefs and sameMarkers turn the first pass into contents page numbers", () => {
  const items = [
    { id: "a", level: 0 as const, title: "A", note: "" },
    { id: "b", level: 1 as const, title: "B", note: "" },
  ];
  assert.deepEqual(pageRefs(items, { a: 3, x: 9 }), { a: 3, b: null });
  assert.equal(sameMarkers({ a: 3, b: 4 }, { b: 4, a: 3 }), true);
  assert.equal(sameMarkers({ a: 3 }, { a: 3, b: 4 }), false);
});

test("packSummary lists missing records per site", () => {
  const summary = packSummary(buildPack(input({ templates: [fridge] })));
  assert.deepEqual(summary, [
    {
      id: "s-truck",
      name: "Truck 1",
      counts: { entries: 0, outOfRange: 0, missingDays: 3, closedDays: 0, unsignedDays: 0 },
      missing: [{ title: "Fridge temperatures", days: 3 }],
    },
  ]);
});
