import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanCode, deviceAdvice, deviceName, groupSecret, mfaErrorMessage, qrDataUrl, removeWarning } from "./mfa.ts";

test("codes: six digits, spaces and dashes allowed", () => {
  assert.equal(cleanCode("123456"), "123456");
  assert.equal(cleanCode(" 123 456 "), "123456");
  assert.equal(cleanCode("123-456"), "123456");
  assert.equal(cleanCode("12345"), null);
  assert.equal(cleanCode("1234567"), null);
  assert.equal(cleanCode("12345a"), null);
  assert.equal(cleanCode(""), null);
});

test("the setup key is shown in groups of four", () => {
  assert.equal(groupSecret("JBSWY3DPEHPK3PXP"), "JBSW Y3DP EHPK 3PXP");
  assert.equal(groupSecret("ABCDEF"), "ABCD EF");
  assert.equal(groupSecret("ABCD"), "ABCD");
});

test("the QR code becomes a properly escaped image URL", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" fill="#000"><path d="M0 0"/></svg>';
  const url = qrDataUrl(`data:image/svg+xml;utf-8,${svg}`);
  assert.ok(url?.startsWith("data:image/svg+xml;charset=utf-8,%3Csvg"));
  assert.ok(!url?.includes("#"), "# would cut the URL short");
  assert.equal(decodeURIComponent(url!.split(",")[1]), svg);
  assert.equal(qrDataUrl(svg), url, "a raw SVG works too");
  assert.equal(qrDataUrl("javascript:alert(1)"), null);
  assert.equal(qrDataUrl("https://evil.example/<svg>"), null);
});

test("device names: default when blank, tidy, not too long", () => {
  assert.deepEqual(deviceName("", 0), { ok: true, name: "My phone" });
  assert.deepEqual(deviceName("  ", 1), { ok: true, name: "Device 2" });
  assert.deepEqual(deviceName("  Work   tablet ", 1), { ok: true, name: "Work tablet" });
  assert.equal(deviceName("x".repeat(41), 0).ok, false);
});

test("auth errors read as plain advice", () => {
  assert.match(mfaErrorMessage("mfa_verification_failed", "x"), /didn't work/);
  assert.match(mfaErrorMessage("insufficient_aal", "x"), /existing device first/);
  assert.equal(mfaErrorMessage("something_new", "Could not check the code"), "Could not check the code");
  assert.equal(mfaErrorMessage(undefined, "fallback"), "fallback");
});

test("one device gets a nudge to add a second", () => {
  assert.equal(deviceAdvice(0, true), null);
  assert.match(deviceAdvice(1, true) ?? "", /owner resets it/);
  assert.match(deviceAdvice(1, false) ?? "", /second device/);
  assert.equal(deviceAdvice(2, true), null);
});

test("removing the last device says what happens next", () => {
  assert.match(removeWarning(1, true), /other device/);
  assert.match(removeWarning(0, true), /set up a new device straight away/);
  assert.match(removeWarning(0, false), /off/);
});
