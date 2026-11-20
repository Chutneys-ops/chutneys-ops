import { test } from "node:test";
import assert from "node:assert/strict";
import {
  actorName,
  areaLabel,
  areaOptions,
  changeList,
  columnLabel,
  describeAudit,
  formatAuditValue,
  thingLabel,
  type AuditEntry,
  type AuditLookups,
} from "./audit.ts";

const ANA = "a0000000-0000-0000-0000-00000000000a";
const MIA = "c0000000-0000-0000-0000-00000000000c";
const SITE = "00000000-0000-0000-0000-000000000003";
const SHEET = "50000000-0000-0000-0000-000000000001";

const lookups: AuditLookups = {
  staff: { [ANA]: "Ana", [MIA]: "Mia" },
  sites: { [SITE]: "Truck - Sandringham" },
  templates: { fridge_daily: "Fridge temperatures" },
  sheets: { [SHEET]: "fridge_daily" },
  units: {},
};

function entry(partial: Partial<AuditEntry>): AuditEntry {
  return {
    id: 1,
    at: "2026-11-20T01:05:00Z",
    actor_id: ANA,
    actor_role: "staff",
    table_name: "purchases",
    row_id: "x",
    action: "insert",
    old_data: null,
    new_data: null,
    changed_fields: null,
    ...partial,
  };
}

test("table and column names, raw names as a fallback", () => {
  assert.equal(areaLabel("purchases"), "Purchases");
  assert.equal(thingLabel("leave_requests"), "leave request");
  assert.equal(areaLabel("new_table"), "new_table");
  assert.equal(columnLabel("purchases", "total_incl_gst"), "Total incl GST");
  assert.equal(columnLabel("staff", "id"), "Person");
  assert.equal(columnLabel("purchases", "mystery_column"), "mystery_column");
  assert.equal(columnLabel("record_templates", "required_daily"), "Required every day");
  const options = areaOptions();
  assert.ok(options.some(([table, label]) => table === "purchases" && label === "Purchases"));
  assert.deepEqual(
    options.map(([, label]) => label),
    [...options.map(([, label]) => label)].sort((a, b) => a.localeCompare(b)),
  );
});

test("values: names for ids, Auckland times, Yes/No, empty", () => {
  assert.equal(formatAuditValue("purchased_by", ANA, lookups), "Ana");
  assert.equal(formatAuditValue("site_id", SITE, lookups), "Truck - Sandringham");
  assert.equal(formatAuditValue("template_code", "fridge_daily", lookups), "Fridge temperatures");
  assert.equal(formatAuditValue("topic", "allergens", lookups), "Allergens");
  assert.equal(formatAuditValue("reimbursed_at", "2026-11-20T01:05:00+00:00", lookups), "Fri 20 Nov, 2:05 pm");
  assert.equal(formatAuditValue("gst_included", true), "Yes");
  assert.equal(formatAuditValue("hours", 7.5), "7.5");
  assert.equal(formatAuditValue("note", null), "(empty)");
  assert.equal(formatAuditValue("purchased_by", "unknown-id", lookups), "unknown-id");
  assert.equal(formatAuditValue("values", { temperature: 4 }), '{"temperature":4}');
  assert.equal(formatAuditValue("note", "x".repeat(100)).length, 80);
});

test("who did it", () => {
  assert.equal(actorName({ actor_id: ANA }, lookups), "Ana");
  assert.equal(actorName({ actor_id: null }, lookups), "System");
  assert.equal(actorName({ actor_id: "gone" }, lookups), "Unknown person");
});

test("what happened: food safety and shifts", () => {
  assert.equal(
    describeAudit(
      entry({
        table_name: "record_sheets",
        action: "update",
        old_data: { template_code: "fridge_daily", signed_off_at: null },
        new_data: { template_code: "fridge_daily", signed_off_at: "2026-11-20T05:00:00Z" },
        changed_fields: ["signed_off_at", "signed_off_by"],
      }),
      lookups,
    ),
    "Signed off Fridge temperatures",
  );
  assert.equal(
    describeAudit(entry({ table_name: "record_entries", new_data: { sheet_id: SHEET } }), lookups),
    "Added an entry to Fridge temperatures",
  );
  assert.equal(
    describeAudit(entry({ table_name: "record_entries", new_data: { sheet_id: SHEET, amends_entry_id: "e1" } }), lookups),
    "Corrected an entry on Fridge temperatures",
  );
  assert.equal(
    describeAudit(entry({ table_name: "shifts", new_data: { site_id: SITE } }), lookups),
    "Chose Truck - Sandringham",
  );
  assert.equal(
    describeAudit(
      entry({
        table_name: "shifts",
        action: "update",
        old_data: { site_id: SITE, clock_out: null },
        new_data: { site_id: SITE, clock_out: "2026-11-20T05:00:00Z", needs_review: false },
        changed_fields: ["clock_out"],
      }),
      lookups,
    ),
    "Left Truck - Sandringham",
  );
  assert.equal(
    describeAudit(
      entry({
        table_name: "shifts",
        action: "update",
        actor_id: MIA,
        old_data: { staff_id: ANA, clock_out: "a" },
        new_data: { staff_id: ANA, clock_out: "b", edit_note: "Left at 4" },
        changed_fields: ["clock_out", "edit_note", "edited_at", "edited_by", "needs_review"],
      }),
      lookups,
    ),
    "Fixed Ana's old clock-out",
  );
});

test("what happened: purchases, leave, training, and the generic fallback", () => {
  assert.equal(describeAudit(entry({ new_data: { supplier: "Pak'nSave" } }), lookups), "Added a purchase from Pak'nSave");
  assert.equal(
    describeAudit(
      entry({
        action: "update",
        old_data: { purchased_by: ANA, reimbursed_at: null },
        new_data: { purchased_by: ANA, reimbursed_at: "2026-11-20T05:00:00Z" },
        changed_fields: ["reimbursed_at", "reimbursed_by"],
      }),
      lookups,
    ),
    "Marked Ana's purchase paid back",
  );
  assert.equal(
    describeAudit(
      entry({
        table_name: "leave_requests",
        action: "update",
        old_data: { staff_id: ANA, status: "pending" },
        new_data: { staff_id: ANA, status: "approved" },
        changed_fields: ["decided_at", "decided_by", "hours", "status"],
      }),
      lookups,
    ),
    "Approved Ana's leave",
  );
  assert.equal(
    describeAudit(
      entry({
        table_name: "leave_requests",
        action: "update",
        old_data: { staff_id: ANA, cleared_to_work_at: null },
        new_data: { staff_id: ANA, cleared_to_work_at: "2026-11-22T05:00:00Z" },
        changed_fields: ["cleared_by", "cleared_to_work_at"],
      }),
      lookups,
    ),
    "Cleared Ana to return to work",
  );
  assert.equal(
    describeAudit(entry({ table_name: "training_records", new_data: { topic: "allergens", trainee_id: ANA } }), lookups),
    "Recorded Allergens training for Ana",
  );
  assert.equal(describeAudit(entry({ table_name: "sites", action: "update", changed_fields: ["name"] })), "Updated site");
  assert.equal(describeAudit(entry({ table_name: "temp_units", action: "delete", old_data: {} })), "Deleted fridge or freezer");
  assert.equal(describeAudit(entry({ table_name: "brand_new", action: "insert", new_data: {} })), "Added brand_new");
});

test("what happened: timesheets", () => {
  const sheet = { staff_id: ANA, work_date: "2026-11-20", start_time: "09:00:00", status: "submitted" };
  assert.equal(describeAudit(entry({ table_name: "timesheets", new_data: sheet }), lookups), "Added their hours for 2026-11-20");
  assert.equal(
    describeAudit(entry({ table_name: "timesheets", actor_id: MIA, new_data: sheet }), lookups),
    "Added Ana's hours for 2026-11-20",
  );
  assert.equal(
    describeAudit(
      entry({
        table_name: "timesheets",
        actor_id: MIA,
        action: "update",
        old_data: sheet,
        new_data: { ...sheet, status: "approved" },
        changed_fields: ["approved_at", "approved_by", "status"],
      }),
      lookups,
    ),
    "Approved Ana's hours for 2026-11-20",
  );
  assert.equal(
    describeAudit(
      entry({
        table_name: "timesheets",
        action: "update",
        old_data: sheet,
        new_data: { ...sheet, start_time: "09:30:00" },
        changed_fields: ["start_time"],
      }),
      lookups,
    ),
    "Changed their hours for 2026-11-20",
  );
  assert.equal(areaLabel("timesheets"), "Timesheets");
  assert.equal(columnLabel("timesheets", "paid_minutes"), "Paid minutes");
  assert.equal(formatAuditValue("approved_by", MIA, lookups), "Mia");
});

test("what happened: staff accounts", () => {
  const OLLY = "d0000000-0000-0000-0000-00000000000d";
  const ana = { id: ANA, name: "Ana", role: "staff", active: true };
  const owner = { actor_id: OLLY, actor_role: "owner", table_name: "staff" };
  assert.equal(describeAudit(entry({ ...owner, action: "insert", new_data: ana }), lookups), "Invited Ana");
  assert.equal(
    describeAudit(entry({ ...owner, actor_id: null, actor_role: "system", action: "insert", new_data: ana }), lookups),
    "Added Ana to staff",
  );
  assert.equal(
    describeAudit(
      entry({ ...owner, action: "update", old_data: ana, new_data: { ...ana, role: "manager" }, changed_fields: ["role"] }),
      lookups,
    ),
    "Changed Ana's role to Manager",
  );
  const off = { ...ana, active: false, deactivated_at: "2026-11-20T01:05:00Z", deactivated_by: OLLY };
  assert.equal(
    describeAudit(
      entry({ ...owner, action: "update", old_data: ana, new_data: off, changed_fields: ["active", "deactivated_at", "deactivated_by"] }),
      lookups,
    ),
    "Turned off Ana's account",
  );
  assert.equal(
    describeAudit(
      entry({ ...owner, action: "update", old_data: off, new_data: ana, changed_fields: ["active", "deactivated_at", "deactivated_by"] }),
      lookups,
    ),
    "Turned Ana's account back on",
  );
  assert.equal(
    describeAudit(
      entry({ ...owner, action: "update", old_data: ana, new_data: { ...ana, invited_at: "2026-11-20T01:05:00Z" }, changed_fields: ["invited_at"] }),
      lookups,
    ),
    "Resent Ana's invite",
  );
  assert.equal(columnLabel("staff", "active"), "Account on");
  assert.equal(columnLabel("sites", "active"), "Open");
  assert.equal(columnLabel("staff", "deactivated_by"), "Turned off by");
  assert.equal(formatAuditValue("deactivated_by", MIA, lookups), "Mia");
});

test("change list: only the changed fields, before and after", () => {
  const list = changeList(
    entry({
      table_name: "leave_requests",
      action: "update",
      old_data: { hours: 16, status: "pending", decided_by: null, note: "Flu" },
      new_data: { hours: 12, status: "approved", decided_by: MIA, note: "Flu" },
      changed_fields: ["decided_by", "hours", "status"],
    }),
    lookups,
  );
  assert.deepEqual(list, [
    { column: "decided_by", label: "Decided by", before: "(empty)", after: "Mia" },
    { column: "hours", label: "Hours", before: "16", after: "12" },
    { column: "status", label: "Status", before: "pending", after: "approved" },
  ]);
  assert.deepEqual(changeList(entry({ action: "insert", new_data: { a: 1 } })), []);
});

// ---- Notices ------------------------------------------------------------------------

const NOTICE = "70000000-0000-0000-0000-000000000001";
const withNotices: AuditLookups = { ...lookups, notices: { [NOTICE]: "Gas bottles" } };

test("notices have friendly names", () => {
  assert.equal(areaLabel("notices"), "Notices");
  assert.equal(areaLabel("notice_reads"), "Notice reads");
  assert.equal(columnLabel("notices", "edited_at"), "Edited at");
  assert.equal(columnLabel("notices", "needs_ack"), "Needs acknowledgement");
  assert.equal(formatAuditValue("site_ids", [SITE], lookups), "Truck - Sandringham");
  assert.equal(formatAuditValue("site_ids", null, lookups), "(empty)");
  assert.equal(formatAuditValue("posted_by", MIA, lookups), "Mia");
});

test("describeAudit: notices", () => {
  const data = { id: NOTICE, title: "Gas bottles", archived_at: null };
  assert.equal(
    describeAudit(entry({ table_name: "notices", actor_id: MIA, new_data: data }), withNotices),
    'Posted notice "Gas bottles"',
  );
  assert.equal(
    describeAudit(
      entry({
        table_name: "notices",
        action: "update",
        old_data: data,
        new_data: { ...data, archived_at: "2026-11-20T02:00:00Z" },
        changed_fields: ["archived_at"],
      }),
      withNotices,
    ),
    'Archived notice "Gas bottles"',
  );
  assert.equal(
    describeAudit(
      entry({
        table_name: "notices",
        action: "update",
        old_data: data,
        new_data: { ...data, title: "Gas bottles", body: "x" },
        changed_fields: ["body", "edited_at"],
      }),
      withNotices,
    ),
    'Edited notice "Gas bottles"',
  );
});

test("describeAudit: notice reads", () => {
  const readRow = { notice_id: NOTICE, staff_id: ANA, acknowledged_at: null };
  assert.equal(
    describeAudit(entry({ table_name: "notice_reads", new_data: readRow }), withNotices),
    'Read "Gas bottles"',
  );
  assert.equal(describeAudit(entry({ table_name: "notice_reads", new_data: readRow }), lookups), "Read a notice");
  assert.equal(
    describeAudit(
      entry({
        table_name: "notice_reads",
        action: "update",
        old_data: readRow,
        new_data: { ...readRow, acknowledged_at: "2026-11-20T02:00:00Z" },
        changed_fields: ["acknowledged_at"],
      }),
      withNotices,
    ),
    'Acknowledged "Gas bottles"',
  );
});

test("what happened: notifications and opening times", () => {
  assert.equal(areaLabel("push_subscriptions"), "Notification devices");
  assert.equal(areaLabel("sent_notifications"), "Reminders sent");
  assert.equal(columnLabel("sites", "opens_at"), "Opens at");
  assert.equal(columnLabel("sent_notifications", "kind"), "Reminder");
  assert.equal(
    describeAudit(
      entry({
        table_name: "sites",
        action: "update",
        old_data: { name: "Cafe", opens_at: "09:00:00" },
        new_data: { name: "Cafe", opens_at: "07:30:00" },
        changed_fields: ["opens_at"],
      }),
    ),
    "Changed Cafe's opening time to 07:30",
  );
  assert.equal(
    describeAudit(entry({ table_name: "push_subscriptions", new_data: { staff_id: ANA } }), lookups),
    "Turned on notifications on a device",
  );
  assert.equal(
    describeAudit(entry({ table_name: "notification_prefs", action: "update", new_data: { roster: false }, changed_fields: ["roster"] })),
    "Changed notification settings",
  );
  assert.equal(
    describeAudit(
      entry({ table_name: "sent_notifications", actor_id: null, new_data: { staff_id: ANA, kind: "fridge_staff" } }),
      lookups,
    ),
    "Sent Ana the fridge temperatures reminder",
  );
});
