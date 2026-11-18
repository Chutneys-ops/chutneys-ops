// YOUR TURN: render one row of the opening checklist.
//
// The page passes you everything below. Your row should:
//   1. Show the item label.
//   2. If ticked, show a ticked box plus who ticked it and when,
//      e.g. "10:22 am · Ana" (use aucklandTime from "@/lib/dates").
//   3. Be one big tap target (a full-width <button>, at least 48px tall)
//      inside a <form>. The form's action is:
//        - untickItem.bind(null, siteId, item.id)  when it's ticked
//        - tickItem.bind(null, siteId, item.id)    when it isn't
//      (import both from "./actions"). .bind fills in the arguments so the
//      form can call the action with no extra inputs.
//   4. When locked is true (already submitted), don't let it change:
//      a disabled button, or no form at all.
//
// Stretch goal: show a "saving" state while the action runs. That needs
// "use client" and the useFormStatus hook from "react-dom" in a small child
// component that renders the button.
import { aucklandTime } from "@/lib/dates";
import { tickItem, untickItem } from "./actions";
export type ChecklistRowProps = {
  siteId: string;
  item: { id: string; label: string };
  tick: { tickedAt: string; tickedBy: string | null } | null;
  locked: boolean;
};

export function ChecklistRow({ siteId, item, tick, locked }: ChecklistRowProps) {
  const action = tick
    ? untickItem.bind(null, siteId, item.id)
    : tickItem.bind(null, siteId, item.id);
  return (
    <li>
      <form action={action}>
        <button
          type="submit"
          disabled={locked}
          aria-pressed={tick != null}
          className="flex min-h-[52px] w-full items-center gap-3 rounded-xl border border-line bg-white px-3 py-2.5 text-left text-ink enabled:hover:border-muted enabled:active:bg-primary-light disabled:cursor-default"
        >
          <span
            aria-hidden="true"
            className={
              tick
                ? "flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg bg-primary"
                : "h-[26px] w-[26px] shrink-0 rounded-lg border-2 border-muted"
            }
          >
            {tick && (
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 12l5 5 9-10" />
              </svg>
            )}
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="text-[15px] leading-snug font-medium">{item.label}</span>
            {tick && (
              <span className="text-[13px] text-primary">
                {aucklandTime(tick.tickedAt)} by {tick.tickedBy ?? "a team member"}
              </span>
            )}
          </span>
        </button>
      </form>
    </li>
  );
}
