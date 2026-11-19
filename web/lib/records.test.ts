import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeSheetStatus,
  findOutOfRange,
  formatClock,
  formatValue,
  groupEntries,
  groupValues,
  isOutOfRange,
  limitText,
  parseEntryForm,
  pendingLaterFields,
  type EntryLike,
  type RecordField,
} from "./records.ts";

const fridgeTemp: RecordField = {
  key: "temperature",
  label: "Temperature",
  type: "number",
  required: true,
  max: 5,
  unit: "C",
};
const coreTemp: RecordField = { key: "core", label: "Core", type: "number", required: true, min: 75, unit: "C" };
const mode: RecordField = { key: "mode", label: "Chilled or hot", type: "select", required: true, options: ["chilled", "hot"] };
const arriving: RecordField = {
  key: "temp_arriving",
  label: "Temp arriving",
  type: "number",
  required: true,
  unit: "C",
  range_when: { field: "mode", ranges: { chilled: { max: 5 }, hot: { min: 60 } } },
};

// A tiny stand-in for FormData.get.
const form = (data: Record<string, string>) => (key: string) => data[key] ?? null;

test("max limit: 5 C is fine, 5.1 C is out of range", () => {
  assert.equal(isOutOfRange(fridgeTemp, 5), false);
  assert.equal(isOutOfRange(fridgeTemp, 5.1), true);
});

test("min limit: cooking below 75 C is out of range", () => {
  assert.equal(isOutOfRange(coreTemp, 74.9), true);
  assert.equal(isOutOfRange(coreTemp, 75), false);
});

test("range_when uses the chosen option", () => {
  assert.equal(isOutOfRange(arriving, 50, { mode: "hot" }), true);
  assert.equal(isOutOfRange(arriving, 50, { mode: "chilled" }), true);
  assert.equal(isOutOfRange(arriving, 4, { mode: "chilled" }), false);
  assert.equal(isOutOfRange(arriving, 65, { mode: "hot" }), false);
  // Nothing chosen yet: no limit to break.
  assert.equal(isOutOfRange(arriving, 50, {}), false);
});

test("findOutOfRange lists the offending keys", () => {
  assert.deepEqual(
    findOutOfRange([mode, arriving], { mode: "hot", temp_arriving: 40 }),
    ["temp_arriving"],
  );
});

test("limit text for the form", () => {
  assert.equal(limitText(fridgeTemp), "5 °C or below");
  assert.equal(limitText(coreTemp), "75 °C or above");
  assert.equal(limitText(arriving), "chilled: 5 °C or below; hot: 60 °C or above");
  assert.equal(limitText(arriving, { mode: "hot" }), "60 °C or above");
});

test("range_from uses the chosen unit's own limits", () => {
  const unitTemp: RecordField = {
    key: "temperature",
    label: "Temperature",
    type: "number",
    max: 5,
    unit: "C",
    range_from: "unit",
  };
  const units = { fridge: { min: 0, max: 5 }, freezer: { min: -25, max: -15 }, old: {} };
  assert.equal(isOutOfRange(unitTemp, -18, { unit: "freezer" }, units), false);
  assert.equal(isOutOfRange(unitTemp, -5, { unit: "freezer" }, units), true);
  assert.equal(isOutOfRange(unitTemp, -30, { unit: "freezer" }, units), true);
  assert.equal(isOutOfRange(unitTemp, 4, { unit: "fridge" }, units), false);
  assert.equal(isOutOfRange(unitTemp, -1, { unit: "fridge" }, units), true);
  // A unit with no limits falls back to the template's 5 C.
  assert.equal(isOutOfRange(unitTemp, 6, { unit: "old" }, units), true);
  assert.equal(limitText(unitTemp, { unit: "freezer" }, units), "between -25 and -15 °C");
  assert.equal(limitText(unitTemp, {}, units), "Limit depends on the unit you pick");
});

test("parse turns form strings into typed values", () => {
  const fields: RecordField[] = [
    fridgeTemp,
    { key: "done", label: "Done", type: "yes_no", required: true },
    { key: "at", label: "At", type: "time" },
    { key: "use_by", label: "Use by", type: "date" },
    { key: "note", label: "Note", type: "text" },
  ];
  const result = parseEntryForm(
    fields,
    form({ temperature: " 4,5 ", done: "no", at: "14:30", use_by: "2026-11-21", note: "" }),
  );
  assert.deepEqual(result.errors, {});
  assert.deepEqual(result.values, { temperature: 4.5, done: false, at: "14:30", use_by: "2026-11-21" });
});

test("parse reports missing and invalid fields", () => {
  const fields: RecordField[] = [
    fridgeTemp,
    mode,
    { key: "at", label: "At", type: "time" },
    { key: "use_by", label: "Use by", type: "date" },
  ];
  const { errors } = parseEntryForm(fields, form({ mode: "lukewarm", at: "25:00", use_by: "2026-02-30" }));
  assert.equal(errors.temperature, "Temperature is required");
  assert.equal(errors.mode, "Pick an option for Chilled or hot");
  assert.ok(errors.at);
  assert.ok(errors.use_by);
});

test("a follow-up skips required fields but needs one value", () => {
  const later: RecordField = { key: "temp_2h", label: "After 2 hours", type: "number", max: 21, later: true };
  const fields = [{ key: "dish", label: "Dish", type: "text", required: true } as RecordField, later];
  assert.deepEqual(parseEntryForm(fields, form({ temp_2h: "18" }), { skipRequired: true }), {
    values: { temp_2h: 18 },
    errors: {},
  });
  assert.equal(
    parseEntryForm(fields, form({}), { skipRequired: true }).errors._form,
    "Add at least one reading",
  );
});

test("formatting values for display", () => {
  assert.equal(formatValue(fridgeTemp, 3.5), "3.5 °C");
  assert.equal(formatValue({ key: "d", label: "D", type: "yes_no" }, true), "Yes");
  assert.equal(formatValue({ key: "t", label: "T", type: "time" }, "14:05"), "2:05 pm");
  assert.equal(formatValue({ key: "u", label: "U", type: "temp_unit" }, "abc", { abc: "Fridge 1" }), "Fridge 1");
  assert.equal(formatValue(fridgeTemp, null), "–");
  assert.equal(formatClock("00:15"), "12:15 am");
  assert.equal(formatClock("12:00"), "12:00 pm");
});

test("sheet status", () => {
  assert.deepEqual(describeSheetStatus({ entryCount: 0, anyOutOfRange: false, signedOffAt: null }), {
    text: "Not started",
    tone: "not-started",
    warning: false,
  });
  assert.equal(describeSheetStatus({ entryCount: 1, anyOutOfRange: false, signedOffAt: null }).text, "1 entry");
  assert.deepEqual(describeSheetStatus({ entryCount: 3, anyOutOfRange: true, signedOffAt: null }), {
    text: "3 entries",
    tone: "in-progress",
    warning: true,
  });
  assert.equal(
    describeSheetStatus({ entryCount: 3, anyOutOfRange: false, signedOffAt: "2026-11-19T05:40:00Z" }).text,
    "Signed off 6:40 pm",
  );
});

test("grouping: follow-ups under their entry, corrections attached", () => {
  const e = (id: string, at: string, extra: Partial<EntryLike> = {}): EntryLike => ({
    id,
    recorded_at: at,
    amends_entry_id: null,
    continues_entry_id: null,
    values: {},
    ...extra,
  });
  const entries = [
    e("c", "2026-11-19T03:00:00Z", { continues_entry_id: "a", values: { temp_2h: 30 } }),
    e("a", "2026-11-19T01:00:00Z", { values: { dish: "Dal" } }),
    e("b", "2026-11-19T02:00:00Z", { values: { dish: "Rice" } }),
    e("d", "2026-11-19T04:00:00Z", { amends_entry_id: "c", values: { temp_2h: 20 } }),
  ];
  const groups = groupEntries(entries);
  assert.deepEqual(groups.map((g) => g.root.entry.id), ["a", "b"]);
  assert.deepEqual(groups[0].followUps.map((n) => n.entry.id), ["c"]);
  assert.deepEqual(groups[0].followUps[0].corrections.map((c) => c.id), ["d"]);
  // The correction's value wins.
  assert.deepEqual(groupValues(groups[0]), { dish: "Dal", temp_2h: 20 });

  const later: RecordField[] = [
    { key: "dish", label: "Dish", type: "text", required: true },
    { key: "temp_2h", label: "2h", type: "number", later: true },
    { key: "temp_6h", label: "6h", type: "number", later: true },
  ];
  assert.deepEqual(pendingLaterFields(later, groupValues(groups[0])).map((f) => f.key), ["temp_6h"]);
});

test("yes/no with an expected answer: the other answer is out of range", () => {
  const check: RecordField = { key: "fridges", label: "Fridges OK", type: "yes_no", required: true, expect: true };
  assert.equal(isOutOfRange(check, false), true);
  assert.equal(isOutOfRange(check, true), false);
  // No expectation: either answer is fine.
  assert.equal(isOutOfRange({ ...check, expect: undefined }, false), false);
  assert.deepEqual(
    findOutOfRange([check], parseEntryForm([check], form({ fridges: "no" })).values),
    ["fridges"],
  );
});
