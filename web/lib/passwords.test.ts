import { test } from "node:test";
import assert from "node:assert/strict";
import {
  authErrorMessage,
  changePasswordProblem,
  MIN_PASSWORD_LENGTH,
  newPasswordProblem,
  setPasswordProblem,
} from "./passwords.ts";

const EMAIL = "ana@test.local";

test("a new password needs at least 10 characters", () => {
  assert.equal(MIN_PASSWORD_LENGTH, 10);
  assert.match(newPasswordProblem("123456789", EMAIL) ?? "", /at least 10/);
  assert.equal(newPasswordProblem("1234567890", EMAIL), null);
  assert.match(newPasswordProblem("", EMAIL) ?? "", /at least 10/);
});

test("a new password can't be the email address, in any case", () => {
  assert.match(newPasswordProblem("ana@test.local", EMAIL) ?? "", /email/);
  assert.match(newPasswordProblem("ANA@Test.Local", EMAIL) ?? "", /email/);
  assert.match(newPasswordProblem(" ana@test.local ", EMAIL) ?? "", /email/);
  assert.equal(newPasswordProblem("ana@test.local!", EMAIL), null);
  // No email known: only the length rule.
  assert.equal(newPasswordProblem("ana@test.local", null), null);
});

test("set password: both boxes must match", () => {
  assert.equal(setPasswordProblem("correct horse", "correct horse", EMAIL), null);
  assert.match(setPasswordProblem("correct horse", "correct hors", EMAIL) ?? "", /don't match/);
  // Length is reported before a mismatch.
  assert.match(setPasswordProblem("short", "other", EMAIL) ?? "", /at least 10/);
});

test("change password: needs the current one and a different new one", () => {
  assert.match(changePasswordProblem("", "correct horse", EMAIL) ?? "", /current password/);
  assert.match(changePasswordProblem("password123", "password123", EMAIL) ?? "", /different/);
  assert.match(changePasswordProblem("password123", "short", EMAIL) ?? "", /at least 10/);
  assert.equal(changePasswordProblem("password123", "correct horse", EMAIL), null);
});

test("auth errors read well", () => {
  assert.match(authErrorMessage("same_password", "x"), /different/);
  // The codes Supabase Auth really returns (checked against the local server).
  assert.match(authErrorMessage("current_password_invalid", "x"), /current password/);
  assert.match(authErrorMessage("current_password_required", "x"), /current password/);
  assert.match(authErrorMessage("weak_password", "x"), /at least 10/);
  assert.equal(authErrorMessage("something_new", "Could not save."), "Could not save.");
  assert.equal(authErrorMessage(undefined, "Could not save."), "Could not save.");
});
