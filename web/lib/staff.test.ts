import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkInvite,
  isRole,
  looksLikeEmail,
  normaliseEmail,
  sortByStatusThenName,
  staffStatus,
  STATUS_LABELS,
} from "./staff.ts";

test("status: turned off wins, then joined or invited", () => {
  assert.equal(staffStatus(true, true), "active");
  assert.equal(staffStatus(true, false), "invited");
  assert.equal(staffStatus(false, true), "deactivated");
  assert.equal(staffStatus(false, false), "deactivated");
  assert.equal(STATUS_LABELS.invited, "Invited, not joined yet");
});

test("roles", () => {
  assert.ok(isRole("staff"));
  assert.ok(isRole("manager"));
  assert.ok(isRole("owner"));
  assert.ok(!isRole("boss"));
  assert.ok(!isRole(""));
});

test("emails are trimmed and lower case", () => {
  assert.equal(normaliseEmail("  Ana@Example.COM "), "ana@example.com");
  assert.ok(looksLikeEmail("ana@example.com"));
  assert.ok(!looksLikeEmail("ana@example"));
  assert.ok(!looksLikeEmail("ana example@x.com"));
  assert.ok(!looksLikeEmail("@example.com"));
});

test("invite form check", () => {
  assert.deepEqual(checkInvite({ name: "  Ana   Smith ", email: " ANA@Example.com", role: "manager" }), {
    ok: true,
    value: { name: "Ana Smith", email: "ana@example.com", role: "manager" },
  });
  assert.deepEqual(checkInvite({ name: " ", email: "ana@example.com", role: "staff" }), {
    ok: false,
    error: "Enter their name.",
  });
  assert.deepEqual(checkInvite({ name: "Ana", email: "", role: "staff" }), {
    ok: false,
    error: "Enter their email address.",
  });
  assert.equal(checkInvite({ name: "Ana", email: "not-an-email", role: "staff" }).ok, false);
  assert.equal(checkInvite({ name: "Ana", email: "ana@example.com", role: "" }).ok, false);
  assert.equal(checkInvite({ name: "x".repeat(101), email: "ana@example.com", role: "staff" }).ok, false);
});

test("list order: active, invited, turned off; by name in each", () => {
  const rows = [
    { name: "Zed", status: "deactivated" as const },
    { name: "Bea", status: "invited" as const },
    { name: "Cat", status: "active" as const },
    { name: "Abe", status: "active" as const },
  ];
  assert.deepEqual(
    sortByStatusThenName(rows).map((r) => r.name),
    ["Abe", "Cat", "Bea", "Zed"],
  );
});
