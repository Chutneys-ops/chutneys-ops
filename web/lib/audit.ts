// Pure helpers for the owner's audit log page: friendly names for tables
// and columns, readable values, and a one-line "what happened" for each row.
// No React, no Supabase, so they run anywhere and under `node --test`.
//
// Unknown tables and columns fall back to their raw names, so a new table
// still shows up sensibly before anyone adds a label here.

import { aucklandShortDay, aucklandTime } from "./dates.ts";
import { isRole, ROLE_LABELS } from "./staff.ts";
import { TOPIC_LABELS, type TrainingTopic } from "./training.ts";

export type AuditAction = "insert" | "update" | "delete";
type Row = Record<string, unknown>;

export type AuditEntry = {
  id: number;
  at: string;
  actor_id: string | null;
  actor_role: string | null;
  table_name: string;
  row_id: string;
  action: AuditAction;
  old_data: Row | null;
  new_data: Row | null;
  changed_fields: string[] | null;
};

/** id -> name lookups, filled by the page with a few batch queries. */
export type AuditLookups = {
  staff: Record<string, string>;
  sites: Record<string, string>;
  /** template code -> title */
  templates: Record<string, string>;
  /** record sheet id -> template code */
  sheets: Record<string, string>;
  /** temp unit id -> name */
  units: Record<string, string>;
};

export const EMPTY_LOOKUPS: AuditLookups = { staff: {}, sites: {}, templates: {}, sheets: {}, units: {} };

// ---- Tables ---------------------------------------------------------------------

/** table -> [area name for the filter, one thing for "Added a ..."] */
const TABLES: Record<string, [string, string]> = {
  staff: ["Staff", "staff member"],
  staff_sites: ["Staff sites (old)", "staff site link"],
  sites: ["Sites", "site"],
  shifts: ["Site choices", "site choice"],
  timesheets: ["Timesheets", "timesheet"],
  record_templates: ["Record templates", "record template"],
  record_sheets: ["Food safety sheets", "record sheet"],
  record_entries: ["Food safety entries", "record entry"],
  temp_units: ["Fridges and freezers", "fridge or freezer"],
  temp_readings: ["Temperature readings (old)", "temperature reading"],
  purchases: ["Purchases", "purchase"],
  leave_requests: ["Sick leave", "leave request"],
  training_records: ["Training", "training record"],
  cash_ups: ["Cash-ups", "cash-up"],
  daily_sales: ["Daily sales", "daily sales figure"],
  alerts: ["Alerts", "alert"],
  checklist_items: ["Checklist items (old)", "checklist item"],
  checklist_runs: ["Checklists (old)", "checklist"],
  checklist_ticks: ["Checklist ticks (old)", "checklist tick"],
};

/** "purchases" -> "Purchases"; unknown tables -> the raw name. */
export function areaLabel(table: string): string {
  return TABLES[table]?.[0] ?? table;
}

/** "purchases" -> "purchase"; unknown tables -> the raw name. */
export function thingLabel(table: string): string {
  return TABLES[table]?.[1] ?? table;
}

/** Every known table as [table, area name], sorted by name, for the filter. */
export function areaOptions(): [string, string][] {
  return Object.entries(TABLES)
    .map(([table, [area]]): [string, string] => [table, area])
    .sort((a, b) => a[1].localeCompare(b[1]));
}

export function isKnownTable(table: string): boolean {
  return table in TABLES;
}

// ---- Columns ----------------------------------------------------------------------

const COLUMNS: Record<string, string> = {
  id: "ID",
  name: "Name",
  role: "Role",
  kind: "Kind",
  active: "Open",
  site_id: "Site",
  staff_id: "Person",
  created_at: "Created",
  note: "Note",
  notes: "Notes",
  comments: "Comments",
  clock_in: "Chose site at",
  clock_out: "Left site at",
  work_date: "Date",
  start_time: "Start",
  finish_time: "Finish",
  start_at: "Started",
  finish_at: "Finished",
  minutes_at_work: "Minutes at work",
  rest_breaks: "Rest breaks",
  meal_breaks: "Meal breaks",
  paid_minutes: "Paid minutes",
  approved_by: "Approved by",
  approved_at: "Approved at",
  created_by: "Entered by",
  needs_review: "Needs fixing",
  edited_by: "Fixed by",
  edited_at: "Fixed at",
  edit_note: "Fix note",
  location_note: "Location",
  template_code: "Record",
  sheet_date: "Date",
  started_by: "Started by",
  signed_off_by: "Signed off by",
  signed_off_at: "Signed off at",
  sheet_id: "Sheet",
  values: "Values",
  recorded_by: "Recorded by",
  recorded_at: "Recorded at",
  out_of_range: "Out of range",
  corrective_action: "Corrective action",
  amends_entry_id: "Corrects entry",
  continues_entry_id: "Follow-up to",
  min_c: "Min °C",
  max_c: "Max °C",
  supplier: "Supplier",
  description: "What was bought",
  total_incl_gst: "Total incl GST",
  gst_included: "GST included",
  gst_amount: "GST",
  payment_method: "Paid by",
  purchased_by: "Bought by",
  purchased_at: "Bought at",
  invoice_path: "Invoice",
  no_receipt_reason: "No receipt reason",
  reimbursed_at: "Paid back at",
  reimbursed_by: "Paid back by",
  reason: "Reason",
  start_date: "First day",
  end_date: "Last day",
  hours: "Hours",
  certificate_path: "Certificate",
  gi_symptoms: "Vomiting or diarrhoea",
  status: "Status",
  decided_by: "Decided by",
  decided_at: "Decided at",
  decision_note: "Decision note",
  cleared_to_work_at: "Cleared to work at",
  cleared_by: "Cleared by",
  topic: "Topic",
  topic_detail: "Topic detail",
  trainee_id: "Trainee",
  trainer_id: "Trainer",
  trained_on: "Trained on",
  trainer_signed_at: "Trainer signed",
  trainee_signed_at: "Trainee signed",
  trainee_signature_path: "Signature",
  title: "Title",
  fields: "Fields",
  period: "Period",
  sort_order: "Order",
  site_kinds: "Site kinds",
  required_daily: "Required every day",
  email: "Email",
  invited_at: "Invite sent",
  deactivated_at: "Turned off at",
  deactivated_by: "Turned off by",
};

// Where a column means something different in one table.
const TABLE_COLUMNS: Record<string, string> = {
  "staff.id": "Person",
  "staff.active": "Account on",
  "sites.id": "Site",
  "shifts.staff_id": "Person",
  "record_templates.code": "Code",
  "temp_units.name": "Unit",
};

/** Friendly column name; the raw name if there's no label. */
export function columnLabel(table: string, column: string): string {
  return TABLE_COLUMNS[`${table}.${column}`] ?? COLUMNS[column] ?? column;
}

// ---- Values ------------------------------------------------------------------------

const STAFF_COLUMNS = new Set([
  "staff_id",
  "edited_by",
  "submitted_by",
  "ticked_by",
  "taken_by",
  "resolved_by",
  "signed_off_by",
  "started_by",
  "recorded_by",
  "purchased_by",
  "reimbursed_by",
  "cleared_by",
  "decided_by",
  "trainee_id",
  "trainer_id",
  "approved_by",
  "created_by",
  "deactivated_by",
]);

const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const TEXT_MAX = 80;

function cut(text: string): string {
  return text.length > TEXT_MAX ? `${text.slice(0, TEXT_MAX - 1)}…` : text;
}

/** One value, readable: names instead of ids, Auckland times, Yes/No. */
export function formatAuditValue(column: string, value: unknown, lookups: AuditLookups = EMPTY_LOOKUPS): string {
  if (value === null || value === undefined || value === "") return "(empty)";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    if (STAFF_COLUMNS.has(column)) return lookups.staff[value] ?? value;
    if (column === "site_id") return lookups.sites[value] ?? value;
    if (column === "unit_id") return lookups.units[value] ?? value;
    if (column === "template_code") return lookups.templates[value] ?? value;
    if (column === "topic" && value in TOPIC_LABELS) return TOPIC_LABELS[value as TrainingTopic];
    if (TIMESTAMP_RE.test(value)) return `${aucklandShortDay(value)}, ${aucklandTime(value)}`;
    return cut(value);
  }
  return cut(JSON.stringify(value));
}

/** Who did it: their name, or "System" for migrations, the seed and the SQL editor. */
export function actorName(entry: Pick<AuditEntry, "actor_id">, lookups: AuditLookups = EMPTY_LOOKUPS): string {
  if (!entry.actor_id) return "System";
  return lookups.staff[entry.actor_id] ?? "Unknown person";
}

// ---- What happened -------------------------------------------------------------------

function str(row: Row | null, key: string): string | null {
  const value = row?.[key];
  return typeof value === "string" ? value : null;
}

function changed(entry: AuditEntry, field: string): boolean {
  return entry.changed_fields?.includes(field) ?? false;
}

/** Set by this update (was empty, now filled in)? */
function becameSet(entry: AuditEntry, field: string): boolean {
  return changed(entry, field) && entry.old_data?.[field] == null && entry.new_data?.[field] != null;
}

/** One line for the list: "Signed off Fridge temperatures", "Approved Ana's hours". */
export function describeAudit(entry: AuditEntry, lookups: AuditLookups = EMPTY_LOOKUPS): string {
  const row = entry.new_data ?? entry.old_data;
  const person = (key: string) => {
    const id = str(row, key);
    return id ? (lookups.staff[id] ?? "someone") : "someone";
  };
  const templateTitle = (code: string | null) => (code ? (lookups.templates[code] ?? code) : "a record");
  const { action } = entry;

  if (action === "delete") return `Deleted ${thingLabel(entry.table_name)}`;

  switch (entry.table_name) {
    case "staff": {
      const name = str(row, "name") ?? "someone";
      // The owner adding a row is an invite; the seed or a migration just adds.
      if (action === "insert") return entry.actor_id ? `Invited ${name}` : `Added ${name} to staff`;
      if (changed(entry, "active")) {
        return entry.new_data?.active === true ? `Turned ${name}'s account back on` : `Turned off ${name}'s account`;
      }
      if (changed(entry, "role")) {
        const role = str(entry.new_data, "role") ?? "";
        return `Changed ${name}'s role to ${isRole(role) ? ROLE_LABELS[role] : role}`;
      }
      if (changed(entry, "invited_at")) return `Resent ${name}'s invite`;
      break;
    }
    case "shifts": {
      const site = lookups.sites[str(row, "site_id") ?? ""] ?? "a site";
      // Since timesheets, a shift row is just "which site today".
      if (action === "insert") return `Chose ${site}`;
      if (changed(entry, "edit_note") || changed(entry, "edited_by")) return `Fixed ${person("staff_id")}'s old clock-out`;
      if (becameSet(entry, "clock_out")) return `Left ${site}`;
      break;
    }
    case "timesheets": {
      const date = str(row, "work_date") ?? "";
      const whose = entry.actor_id && entry.actor_id === str(row, "staff_id") ? "their" : `${person("staff_id")}'s`;
      if (action === "insert") return `Added ${whose} hours for ${date}`;
      if (changed(entry, "status") && str(entry.new_data, "status") === "approved") {
        return `Approved ${person("staff_id")}'s hours for ${date}`;
      }
      return `Changed ${whose} hours for ${date}`;
    }
    case "record_sheets": {
      const title = templateTitle(str(row, "template_code"));
      if (action === "insert") return `Started ${title}`;
      if (becameSet(entry, "signed_off_at")) return `Signed off ${title}`;
      break;
    }
    case "record_entries": {
      if (action === "insert") {
        const title = templateTitle(lookups.sheets[str(row, "sheet_id") ?? ""] ?? null);
        if (str(row, "amends_entry_id")) return `Corrected an entry on ${title}`;
        if (str(row, "continues_entry_id")) return `Added a follow-up reading on ${title}`;
        return `Added an entry to ${title}`;
      }
      break;
    }
    case "purchases": {
      if (action === "insert") return `Added a purchase from ${str(row, "supplier") ?? "a supplier"}`;
      if (becameSet(entry, "reimbursed_at")) return `Marked ${person("purchased_by")}'s purchase paid back`;
      break;
    }
    case "leave_requests": {
      if (action === "insert") {
        return row?.gi_symptoms === true ? "Requested sick leave (vomiting or diarrhoea)" : "Requested sick leave";
      }
      if (becameSet(entry, "cleared_to_work_at")) return `Cleared ${person("staff_id")} to return to work`;
      if (changed(entry, "status")) {
        const verb = str(entry.new_data, "status") === "approved" ? "Approved" : "Declined";
        return `${verb} ${person("staff_id")}'s leave`;
      }
      break;
    }
    case "training_records": {
      const topic = str(row, "topic");
      const label = topic && topic in TOPIC_LABELS ? TOPIC_LABELS[topic as TrainingTopic] : (topic ?? "training");
      if (action === "insert") return `Recorded ${label} training for ${person("trainee_id")}`;
      if (becameSet(entry, "trainee_signed_at")) return `Confirmed ${label} training`;
      break;
    }
  }

  const verb = action === "insert" ? "Added" : "Updated";
  return `${verb} ${thingLabel(entry.table_name)}`;
}

/** For updates: the changed columns only, with before and after. */
export function changeList(
  entry: AuditEntry,
  lookups: AuditLookups = EMPTY_LOOKUPS,
): { column: string; label: string; before: string; after: string }[] {
  if (entry.action !== "update" || !entry.changed_fields) return [];
  return entry.changed_fields.map((column) => ({
    column,
    label: columnLabel(entry.table_name, column),
    before: formatAuditValue(column, entry.old_data?.[column], lookups),
    after: formatAuditValue(column, entry.new_data?.[column], lookups),
  }));
}
