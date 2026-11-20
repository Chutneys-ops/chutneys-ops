import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTrainingMatrix, matrixDate, validateTraining, type TrainingInput } from "./training.ts";

const TODAY = "2026-11-20";
const ME = "manager-id";
const input: TrainingInput = {
  trainee_id: "ana-id",
  topic: "allergens",
  topic_detail: "",
  trained_on: "",
  notes: " Peanut and gluten ",
};

test("record training: good input, date defaults to today", () => {
  const { values, errors } = validateTraining(input, TODAY, ME);
  assert.deepEqual(errors, {});
  assert.deepEqual(values, {
    trainee_id: "ana-id",
    topic: "allergens",
    topic_detail: null,
    trained_on: TODAY,
    notes: "Peanut and gluten",
  });
});

test("record training: errors", () => {
  assert.ok(validateTraining({ ...input, trainee_id: "" }, TODAY, ME).errors.trainee_id);
  assert.ok(validateTraining({ ...input, trainee_id: ME }, TODAY, ME).errors.trainee_id);
  assert.ok(validateTraining({ ...input, topic: "juggling" }, TODAY, ME).errors.topic);
  assert.ok(validateTraining({ ...input, topic: "other" }, TODAY, ME).errors.topic_detail);
  assert.deepEqual(validateTraining({ ...input, topic: "other", topic_detail: "Fire drill" }, TODAY, ME).errors, {});
  assert.ok(validateTraining({ ...input, trained_on: "2026-11-21" }, TODAY, ME).errors.trained_on);
  assert.ok(validateTraining({ ...input, trained_on: "2026-02-30" }, TODAY, ME).errors.trained_on);
});

test("matrix: latest date per person and topic, blank if never trained", () => {
  const rows = buildTrainingMatrix(
    [
      { id: "ben", name: "Ben" },
      { id: "ana", name: "Ana" },
    ],
    [
      { trainee_id: "ana", topic: "allergens", trained_on: "2026-03-01", trainee_signed_at: "x" },
      { trainee_id: "ana", topic: "allergens", trained_on: "2026-10-01", trainee_signed_at: null },
      { trainee_id: "ana", topic: "cleaning", trained_on: "2026-05-05", trainee_signed_at: null },
      { trainee_id: "ana", topic: "cleaning", trained_on: "2026-05-05", trainee_signed_at: "x" },
      { trainee_id: "ben", topic: "induction", trained_on: "2026-11-01", trainee_signed_at: "x" },
      { trainee_id: "gone", topic: "induction", trained_on: "2026-11-01", trainee_signed_at: "x" },
    ],
  );
  assert.deepEqual(
    rows.map((r) => r.name),
    ["Ana", "Ben"],
  );
  const [ana, ben] = rows;
  assert.deepEqual(ana.cells.allergens, { date: "2026-10-01", confirmed: false });
  assert.deepEqual(ana.cells.cleaning, { date: "2026-05-05", confirmed: true });
  assert.equal(ana.cells.induction, null);
  assert.deepEqual(ben.cells.induction, { date: "2026-11-01", confirmed: true });
  assert.equal(ben.cells.allergens, null);
});

test("matrix dates are day/month/year", () => {
  assert.equal(matrixDate("2026-03-01"), "1/3/26");
  assert.equal(matrixDate("2026-11-20"), "20/11/26");
});
