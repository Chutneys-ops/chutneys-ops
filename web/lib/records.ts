// Pure helpers for food safety records: no React, no Supabase, so they run
// in the browser, on the server and under `node --test`.
//
// The database trigger (record_entries_before_insert) is the real guard.
// These functions mirror it so the form can warn early and explain clearly.

import { aucklandTime } from "./dates.ts";

export type FieldType = "text" | "number" | "time" | "date" | "select" | "yes_no" | "temp_unit";

export type Range = { min?: number; max?: number };

export type RecordField = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  min?: number;
  max?: number;
  unit?: string;
  options?: string[];
  /** Swap in a different range depending on another field, e.g. chilled or hot. */
  range_when?: { field: string; ranges: Record<string, Range> };
  /** Filled in hours later, as a follow-up entry (cooling, batter). */
  later?: boolean;
};

export type RecordTemplate = {
  code: string;
  title: string;
  description: string | null;
  period: "daily" | "event";
  fields: RecordField[];
};

export type FieldValue = string | number | boolean;
export type EntryValues = Record<string, FieldValue | null | undefined>;

const TEXT_MAX = 500;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

// ---- Ranges ----------------------------------------------------------------

/** The min/max that applies to a number field, given the other values. */
export function limitFor(field: RecordField, values: EntryValues = {}): Range {
  const range: Range = { min: field.min, max: field.max };
  if (field.range_when) {
    const chosen = values[field.range_when.field];
    const override = typeof chosen === "string" ? field.range_when.ranges[chosen] : undefined;
    if (override) {
      if (override.min !== undefined) range.min = override.min;
      if (override.max !== undefined) range.max = override.max;
    }
  }
  return range;
}

function unitText(unit: string | undefined): string {
  if (!unit) return "";
  return unit === "C" ? " °C" : ` ${unit}`;
}

/** "5 °C or below", "75 °C or above", "between 2 and 8 °C", or "" if no limit. */
export function rangeText(range: Range, unit?: string): string {
  const u = unitText(unit);
  const { min, max } = range;
  if (min !== undefined && max !== undefined) return `between ${min} and ${max}${u}`;
  if (max !== undefined) return `${max}${u} or below`;
  if (min !== undefined) return `${min}${u} or above`;
  return "";
}

/** The limit to show under a field's label. Lists each case for range_when. */
export function limitText(field: RecordField, values: EntryValues = {}): string {
  if (field.type !== "number") return "";
  if (field.range_when) {
    const chosen = values[field.range_when.field];
    if (typeof chosen === "string" && field.range_when.ranges[chosen]) {
      return rangeText(limitFor(field, values), field.unit);
    }
    return Object.entries(field.range_when.ranges)
      .map(([option, range]) => `${option}: ${rangeText(range, field.unit)}`)
      .join("; ");
  }
  return rangeText(limitFor(field), field.unit);
}

/** Is this number outside the field's limits? Non-numbers are never "out of range". */
export function isOutOfRange(field: RecordField, value: unknown, values: EntryValues = {}): boolean {
  if (field.type !== "number" || typeof value !== "number") return false;
  const { min, max } = limitFor(field, values);
  return (min !== undefined && value < min) || (max !== undefined && value > max);
}

/** Keys of the fields that are out of range. */
export function findOutOfRange(fields: RecordField[], values: EntryValues): string[] {
  return fields.filter((f) => isOutOfRange(f, values[f.key], values)).map((f) => f.key);
}

// ---- Parsing a submitted form --------------------------------------------

export type ParseResult = {
  values: Record<string, FieldValue>;
  errors: Record<string, string>;
};

/**
 * Turn form strings into typed JSON values: numbers become numbers, yes/no
 * becomes true/false, blanks are left out. `get` reads one form field.
 * skipRequired is for follow-up readings and corrections of them.
 */
export function parseEntryForm(
  fields: RecordField[],
  get: (key: string) => string | null,
  options: { skipRequired?: boolean } = {},
): ParseResult {
  const values: Record<string, FieldValue> = {};
  const errors: Record<string, string> = {};

  for (const field of fields) {
    const raw = get(field.key);
    if (isBlank(raw)) {
      if (field.required && !options.skipRequired) errors[field.key] = `${field.label} is required`;
      continue;
    }
    const text = (raw as string).trim();

    switch (field.type) {
      case "number": {
        // Allow "4,5" as well as "4.5".
        const num = Number(text.replace(",", "."));
        if (!Number.isFinite(num)) errors[field.key] = `${field.label} must be a number`;
        else values[field.key] = num;
        break;
      }
      case "time":
        if (!TIME_RE.test(text)) errors[field.key] = `${field.label} must be a time like 14:30`;
        else values[field.key] = text;
        break;
      case "date":
        if (!isRealDate(text)) errors[field.key] = `${field.label} must be a date`;
        else values[field.key] = text;
        break;
      case "select":
        if (!field.options?.includes(text)) errors[field.key] = `Pick an option for ${field.label}`;
        else values[field.key] = text;
        break;
      case "yes_no":
        if (text === "yes") values[field.key] = true;
        else if (text === "no") values[field.key] = false;
        else errors[field.key] = `${field.label} must be yes or no`;
        break;
      case "temp_unit":
      case "text":
        if (text.length > TEXT_MAX) errors[field.key] = `${field.label} is too long`;
        else values[field.key] = text;
        break;
    }
  }

  if (options.skipRequired && Object.keys(values).length === 0 && Object.keys(errors).length === 0) {
    errors._form = "Add at least one reading";
  }
  return { values, errors };
}

function isRealDate(text: string): boolean {
  if (!DATE_RE.test(text)) return false;
  const d = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text;
}

// ---- Showing values ------------------------------------------------------

const dateFormat = new Intl.DateTimeFormat("en-NZ", {
  timeZone: "UTC", // a plain date has no timezone; UTC keeps it unchanged
  weekday: "short",
  day: "numeric",
  month: "short",
});

/** "14:30" -> "2:30 pm". */
export function formatClock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h < 12 ? "am" : "pm";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** One value as text, e.g. "3.5 °C", "Yes", "2:30 pm", "Fridge 1". */
export function formatValue(
  field: RecordField,
  value: unknown,
  unitNames: Record<string, string> = {},
): string {
  if (isBlank(value)) return "–";
  switch (field.type) {
    case "number":
      return `${value}${unitText(field.unit)}`;
    case "yes_no":
      return value === true ? "Yes" : "No";
    case "time":
      return typeof value === "string" && TIME_RE.test(value) ? formatClock(value) : String(value);
    case "date":
      return typeof value === "string" && isRealDate(value)
        ? dateFormat.format(new Date(`${value}T00:00:00Z`))
        : String(value);
    case "temp_unit":
      return unitNames[String(value)] ?? "Unknown unit";
    default:
      return String(value);
  }
}

// ---- Sheet status --------------------------------------------------------

export type SheetTone = "done" | "in-progress" | "not-started";

/** One line for the records list: "Not started", "3 entries", "Signed off 6:40 pm". */
export function describeSheetStatus({
  entryCount,
  anyOutOfRange,
  signedOffAt,
}: {
  entryCount: number;
  anyOutOfRange: boolean;
  signedOffAt: string | null;
}): { text: string; tone: SheetTone; warning: boolean } {
  const warning = anyOutOfRange;
  if (signedOffAt) return { text: `Signed off ${aucklandTime(signedOffAt)}`, tone: "done", warning };
  if (entryCount === 0) return { text: "Not started", tone: "not-started", warning };
  return {
    text: `${entryCount} ${entryCount === 1 ? "entry" : "entries"}`,
    tone: "in-progress",
    warning,
  };
}

// ---- Grouping entries ----------------------------------------------------

export type EntryLike = {
  id: string;
  amends_entry_id: string | null;
  continues_entry_id: string | null;
  recorded_at: string;
  values: EntryValues;
};

export type EntryNode<E> = { entry: E; corrections: E[] };
export type EntryGroup<E> = { root: EntryNode<E>; followUps: EntryNode<E>[] };

/**
 * Arrange flat entries for display: each original entry with its follow-up
 * readings underneath, and corrections attached to the entry they correct.
 * Everything stays in recorded order.
 */
export function groupEntries<E extends EntryLike>(entries: E[]): EntryGroup<E>[] {
  const sorted = [...entries].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
  const nodes = new Map<string, EntryNode<E>>();
  for (const e of sorted) {
    if (!e.amends_entry_id) nodes.set(e.id, { entry: e, corrections: [] });
  }

  const groups: EntryGroup<E>[] = [];
  const groupByRoot = new Map<string, EntryGroup<E>>();
  for (const e of sorted) {
    if (e.amends_entry_id) {
      const target = nodes.get(e.amends_entry_id);
      // A correction of a missing entry shouldn't happen; show it on its own.
      if (target) target.corrections.push(e);
      else {
        const group = { root: { entry: e, corrections: [] }, followUps: [] };
        groups.push(group);
      }
      continue;
    }
    const node = nodes.get(e.id)!;
    const parent = e.continues_entry_id ? groupByRoot.get(e.continues_entry_id) : undefined;
    if (parent) parent.followUps.push(node);
    else {
      const group: EntryGroup<E> = { root: node, followUps: [] };
      groups.push(group);
      groupByRoot.set(e.id, group);
    }
  }
  return groups;
}

/** The latest value of every field across a group, corrections included. */
export function groupValues<E extends EntryLike>(group: EntryGroup<E>): EntryValues {
  const merged: EntryValues = {};
  for (const node of [group.root, ...group.followUps]) {
    const latest = node.corrections.at(-1) ?? node.entry;
    for (const [key, value] of Object.entries(latest.values)) {
      if (!isBlank(value)) merged[key] = value;
    }
  }
  return merged;
}

/** "later" fields still empty for this group: what "Add next reading" asks for. */
export function pendingLaterFields(fields: RecordField[], values: EntryValues): RecordField[] {
  return fields.filter((f) => f.later && isBlank(values[f.key]));
}
