import { test } from "node:test";
import assert from "node:assert/strict";
import { DAILY_MESSAGES, pickMessage } from "./daily-messages.ts";

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

test("about 60 short, unique lines", () => {
  assert.ok(DAILY_MESSAGES.length >= 55 && DAILY_MESSAGES.length <= 65, String(DAILY_MESSAGES.length));
  assert.equal(new Set(DAILY_MESSAGES).size, DAILY_MESSAGES.length, "no duplicates");
  for (const line of DAILY_MESSAGES) {
    assert.ok(line.length > 10 && line.length <= 90, `too long or short: ${line}`);
  }
});

test("the same day gives the same message", () => {
  assert.equal(pickMessage("2026-11-20"), pickMessage("2026-11-20"));
});

test("the message changes every day", () => {
  let day = "2026-11-20";
  for (let i = 0; i < DAILY_MESSAGES.length; i++) {
    const next = addDays(day, 1);
    assert.notEqual(pickMessage(day), pickMessage(next), `${day} and ${next}`);
    day = next;
  }
});

test("every line gets used, then the list wraps around", () => {
  const start = "2026-11-20";
  const seen = new Set<string>();
  for (let i = 0; i < DAILY_MESSAGES.length; i++) seen.add(pickMessage(addDays(start, i)));
  assert.equal(seen.size, DAILY_MESSAGES.length);
  assert.equal(pickMessage(addDays(start, DAILY_MESSAGES.length)), pickMessage(start));
});

test("works with any list and odd input", () => {
  assert.equal(pickMessage("1970-01-01", ["a", "b", "c"]), "a");
  assert.equal(pickMessage("1970-01-02", ["a", "b", "c"]), "b");
  assert.equal(pickMessage("1969-12-31", ["a", "b", "c"]), "c"); // before 1970 still wraps
  assert.equal(pickMessage("not a date", ["a", "b"]), "a");
  assert.equal(pickMessage("2026-11-20", []), "");
});
