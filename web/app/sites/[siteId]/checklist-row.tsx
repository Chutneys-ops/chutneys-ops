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
          className="flex w-full min-h-12 items-center gap-3 rounded-lg border p-3 text-left disabled:cursor-default"
        >
          <span 
            aria-hidden="true"
            className={
              tick
                ? "flex h-6 w-6 shrink-0 items-center justify-center rounded bg-green-700 text-white"
                : "h-6 w-6 shrink-0 rounded border-2 border-gray-400"
            }
          >
            {tick ? "✓" : ""}
          </span>
          <span className="flex flex-col">
            <span>{item.label}</span>
            {tick && (
              <span className="text-sm text-green-700">
                {aucklandTime(tick.tickedAt)} by {tick.tickedBy ?? "a team member"}
              </span>
            )}
          </span>
        </button>
      </form>
    </li>
  );
}
