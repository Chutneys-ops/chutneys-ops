import { aucklandTime } from "./dates.ts";

export type ChecklistStatus = {
  done: number;
  total: number;
  submittedAt: string | null;
};

export type StatusTone = "done" | "in-progress" | "not-started" | "none";

/** One line for the /sites list: "3 of 8 done", "Submitted 10:22 am", ... */
export function describeStatus({ done, total, submittedAt }: ChecklistStatus): {
  text: string;
  tone: StatusTone;
} {
  if (submittedAt) return { text: `Submitted ${aucklandTime(submittedAt)}`, tone: "done" };
  if (total === 0) return { text: "No opening checklist", tone: "none" };
  if (done === 0) return { text: `Not started (0 of ${total})`, tone: "not-started" };
  return { text: `${done} of ${total} done`, tone: "in-progress" };
}
