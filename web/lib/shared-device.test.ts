import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deviceModeText,
  IDLE_LIMIT_MS,
  idleTooLong,
  keysToClear,
  LAST_ACTIVE_KEY,
  msUntilIdle,
  parseLastActive,
  SHARED_DEVICE_KEY,
} from "./shared-device.ts";

const NOW = 1_800_000_000_000;

test("15 minutes without use signs out, not a second earlier", () => {
  assert.equal(IDLE_LIMIT_MS, 15 * 60 * 1000);
  assert.equal(idleTooLong(NOW - IDLE_LIMIT_MS + 1000, NOW), false);
  assert.equal(idleTooLong(NOW - IDLE_LIMIT_MS, NOW), true);
  assert.equal(idleTooLong(NOW - 60 * 60 * 1000, NOW), true, "a tablet that slept for an hour");
  assert.equal(idleTooLong(null, NOW), false, "no record yet: just signed in");
});

test("time left until the idle sign-out", () => {
  assert.equal(msUntilIdle(NOW, NOW), IDLE_LIMIT_MS);
  assert.equal(msUntilIdle(NOW - 60_000, NOW), IDLE_LIMIT_MS - 60_000);
  assert.equal(msUntilIdle(NOW - 2 * IDLE_LIMIT_MS, NOW), 0);
  assert.equal(msUntilIdle(null, NOW), IDLE_LIMIT_MS);
});

test("the stored time is read carefully", () => {
  assert.equal(parseLastActive(String(NOW)), NOW);
  assert.equal(parseLastActive(null), null);
  assert.equal(parseLastActive("soon"), null);
  assert.equal(parseLastActive("-5"), null);
});

test("sign out clears our keys but keeps the device's own settings", () => {
  assert.deepEqual(
    keysToClear([SHARED_DEVICE_KEY, "chutneys.installCardDismissed", LAST_ACTIVE_KEY, "chutneys.draft", "sb-other"]),
    [LAST_ACTIVE_KEY, "chutneys.draft"],
  );
});

test("Settings says which mode the device is in", () => {
  assert.equal(deviceModeText(true).title, "Shared device");
  assert.match(deviceModeText(true).detail, /15 minutes/);
  assert.equal(deviceModeText(false).title, "Personal device");
});
