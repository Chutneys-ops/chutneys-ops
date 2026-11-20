// Pure helpers for training records: no React, no Supabase, so they run in
// the browser, on the server and under `node --test`.

import { isYmd } from "./leave.ts";

export const TRAINING_TOPICS = [
  "food_safety_basics",
  "handwashing_and_hygiene",
  "allergens",
  "cleaning",
  "temperature_control",
  "cooking_cooling_reheating",
  "batter_fermentation",
  "induction",
  "other",
] as const;
export type TrainingTopic = (typeof TRAINING_TOPICS)[number];

export const TOPIC_LABELS: Record<TrainingTopic, string> = {
  food_safety_basics: "Food safety basics",
  handwashing_and_hygiene: "Handwashing and hygiene",
  allergens: "Allergens",
  cleaning: "Cleaning",
  temperature_control: "Temperature control",
  cooking_cooling_reheating: "Cooking, cooling and reheating",
  batter_fermentation: "Dosa and idli batter",
  induction: "Induction",
  other: "Other",
};

/** Short column headings for the matrix on a phone. */
export const TOPIC_SHORT: Record<TrainingTopic, string> = {
  food_safety_basics: "Food safety",
  handwashing_and_hygiene: "Hygiene",
  allergens: "Allergens",
  cleaning: "Cleaning",
  temperature_control: "Temps",
  cooking_cooling_reheating: "Cook/cool",
  batter_fermentation: "Batter",
  induction: "Induction",
  other: "Other",
};

export type TrainingInput = {
  trainee_id: string;
  topic: string;
  topic_detail: string;
  trained_on: string;
  notes: string;
};

export type TrainingValues = {
  trainee_id: string;
  topic: TrainingTopic;
  topic_detail: string | null;
  trained_on: string;
  notes: string | null;
};

/** Check the "Record training" form. `trainerId` is you: you can't train yourself. */
export function validateTraining(
  input: TrainingInput,
  today: string,
  trainerId: string,
): { values: TrainingValues | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const detail = input.topic_detail.trim();
  const notes = input.notes.trim();
  const trainedOn = input.trained_on.trim() || today;

  if (!input.trainee_id) errors.trainee_id = "Who did you train?";
  else if (input.trainee_id === trainerId) errors.trainee_id = "You can't record training for yourself";

  const topic = TRAINING_TOPICS.find((t) => t === input.topic);
  if (!topic) errors.topic = "Pick a topic";
  if (topic === "other" && !detail) errors.topic_detail = "Say what the training was";
  if (detail.length > 200) errors.topic_detail = "Keep it under 200 characters";

  if (!isYmd(trainedOn)) errors.trained_on = "Pick the date";
  else if (trainedOn > today) errors.trained_on = "The date can't be in the future";

  if (notes.length > 500) errors.notes = "Keep it under 500 characters";

  if (Object.keys(errors).length > 0 || !topic) return { values: null, errors };
  return {
    values: {
      trainee_id: input.trainee_id,
      topic,
      topic_detail: detail || null,
      trained_on: trainedOn,
      notes: notes || null,
    },
    errors,
  };
}

// ---- The matrix -----------------------------------------------------------------

export type MatrixRecord = {
  trainee_id: string;
  topic: TrainingTopic;
  trained_on: string;
  trainee_signed_at: string | null;
};

export type MatrixCell = { date: string; confirmed: boolean } | null;
export type MatrixRow = { id: string; name: string; cells: Record<TrainingTopic, MatrixCell> };

/** Staff down the side, topics across, the latest training date in each
 *  cell (null if never trained). On the same date, a confirmed record wins. */
export function buildTrainingMatrix(staff: { id: string; name: string }[], records: MatrixRecord[]): MatrixRow[] {
  const rows = new Map<string, MatrixRow>();
  for (const person of staff) {
    const cells = Object.fromEntries(TRAINING_TOPICS.map((t) => [t, null])) as Record<TrainingTopic, MatrixCell>;
    rows.set(person.id, { id: person.id, name: person.name, cells });
  }
  for (const r of records) {
    const row = rows.get(r.trainee_id);
    if (!row) continue;
    const current = row.cells[r.topic];
    const confirmed = r.trainee_signed_at !== null;
    if (!current || r.trained_on > current.date || (r.trained_on === current.date && confirmed && !current.confirmed)) {
      row.cells[r.topic] = { date: r.trained_on, confirmed };
    }
  }
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** "2026-03-01" -> "1/3/26": short enough for a matrix cell on a phone. */
export function matrixDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${d}/${m}/${String(y).slice(2)}`;
}
