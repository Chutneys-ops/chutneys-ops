// A radio button styled as a big tappable choice ("Yes" / "No", "Company
// card" / "Till cash" / "Own money"). The ONE place these styles live, so
// the forms (purchases, leave, records) can't drift apart again.
//
//   unselected: white with ink text. The colour is set here on purpose
//               rather than inherited, so it stays readable wherever the
//               component is placed (on a coloured card, or in a future
//               dark theme).
//   selected:   green border, light green background, dark green text
//               (has-checked: the label contains a checked input).
//   keyboard:   a visible focus ring. The radio itself may be visually
//               hidden, so the label shows the focus instead.
//   disabled:   dimmed.
//
// A plain component (no hooks), so it works in server and client forms.

import type { InputHTMLAttributes, ReactNode } from "react";

export const choiceOptionClass = [
  "flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border px-2 text-center font-medium",
  // Unselected
  "border-line bg-white text-ink hover:border-muted",
  // Selected
  "has-checked:border-primary has-checked:bg-primary-light has-checked:text-primary-dark",
  // Keyboard focus (on the radio inside)
  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-white",
  // Disabled
  "has-disabled:cursor-not-allowed has-disabled:opacity-60",
].join(" ");

// "size" is left out: <input> has its own numeric size attribute.
type ChoiceOptionProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className" | "children" | "size"> & {
  children: ReactNode;
  /** "sm" (default) for rows of 2-3 short choices; "md" for big Yes/No. */
  textSize?: "sm" | "md";
  /** Show the round radio dot too (records' Yes/No). Hidden by default:
   *  the whole button is the control. */
  showRadio?: boolean;
};

export function ChoiceOption({ children, textSize = "sm", showRadio = false, ...input }: ChoiceOptionProps) {
  return (
    <label className={`${choiceOptionClass} ${textSize === "sm" ? "text-sm" : "text-base"}`}>
      <input type="radio" {...input} className={showRadio ? "h-5 w-5 shrink-0 accent-primary" : "sr-only"} />
      {children}
    </label>
  );
}
