import { test } from "node:test";
import assert from "node:assert/strict";
import { describeStatus } from "./checklist-status.ts";

test("submitted shows the Auckland time", () => {
  assert.deepEqual(
    describeStatus({ done: 8, total: 8, submittedAt: "2026-11-16T21:22:00Z" }),
    { text: "Submitted 10:22 am", tone: "done" },
  );
});

test("part done shows a count", () => {
  assert.deepEqual(describeStatus({ done: 3, total: 8, submittedAt: null }), {
    text: "3 of 8 done",
    tone: "in-progress",
  });
});

test("nothing ticked yet", () => {
  assert.equal(
    describeStatus({ done: 0, total: 8, submittedAt: null }).text,
    "Not started (0 of 8)",
  );
});

test("a site kind with no items", () => {
  assert.equal(describeStatus({ done: 0, total: 0, submittedAt: null }).tone, "none");
});
