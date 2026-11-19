"use client";

// A form generated from a template's fields. Used three ways:
//   new        - a normal entry on today's sheet
//   followup   - a later reading for a dish or batch (only the "later" fields)
//   correction - pick an earlier entry, re-enter it, and say why
//
// It warns as you type when a number is out of range (same rules as the
// database trigger, from lib/records.ts), and then asks for the corrective
// action. The server action and the trigger still check everything.

import { useActionState, useState, type FormEvent } from "react";
import {
  findOutOfRange,
  limitText,
  parseEntryForm,
  type EntryValues,
  type RecordField,
} from "@/lib/records";
import { initialFormState, type FormState } from "./form-state";

type Mode = "new" | "followup" | "correction";

export type EntryFormProps = {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  fields: RecordField[];
  units: { id: string; name: string }[];
  mode: Mode;
  submitLabel: string;
  /** The original entry's values (follow-ups), so "hot"/"chilled" limits work. */
  baseValues?: EntryValues;
  /** Entries you can pick from in correction mode. */
  correctable?: { id: string; label: string }[];
};

export function EntryForm(props: EntryFormProps) {
  const [state, formAction, pending] = useActionState(props.action, initialFormState);
  // key={state.seq}: after each submit the form remounts. After a save it is
  // empty again; after an error it comes back with what you typed.
  return <EntryFormBody key={state.seq} {...props} state={state} formAction={formAction} pending={pending} />;
}

const inputClass =
  "min-h-12 w-full rounded-xl border bg-white px-3 text-base text-ink focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none";

function readForm(form: HTMLFormElement): Record<string, string> {
  const out: Record<string, string> = {};
  new FormData(form).forEach((value, key) => {
    if (typeof value === "string") out[key] = value;
  });
  return out;
}

function EntryFormBody({
  fields,
  units,
  mode,
  submitLabel,
  baseValues = {},
  correctable = [],
  state,
  formAction,
  pending,
}: EntryFormProps & {
  state: FormState;
  formAction: (formData: FormData) => void;
  pending: boolean;
}) {
  // What's typed right now, for the live out-of-range warning.
  const [live, setLive] = useState<Record<string, string>>(state.values ?? {});
  const typed = parseEntryForm(fields, (key) => live[key] ?? null, { skipRequired: true }).values;
  const allValues = { ...baseValues, ...typed };
  const outKeys = new Set(findOutOfRange(fields, allValues));
  const errors = state.errors ?? {};
  const showAction = outKeys.size > 0 || Boolean(errors.corrective_action);
  const defaults = state.values ?? {};
  const idPrefix = `${mode}-${fields.map((f) => f.key).join("-")}`;

  return (
    <form
      action={formAction}
      onChange={(event: FormEvent<HTMLFormElement>) => setLive(readForm(event.currentTarget))}
      className="space-y-4"
    >
      {mode === "correction" && (
        <div>
          <label htmlFor={`${idPrefix}-amends`} className="block text-sm font-semibold text-ink">
            Which entry are you correcting?
          </label>
          <select
            id={`${idPrefix}-amends`}
            name="amends_entry_id"
            required
            defaultValue={defaults.amends_entry_id ?? ""}
            aria-invalid={Boolean(errors.amends_entry_id)}
            className={`${inputClass} mt-1.5 ${errors.amends_entry_id ? "border-warning" : "border-line"}`}
          >
            <option value="">Choose an entry…</option>
            {correctable.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
          {errors.amends_entry_id && <p className="mt-1 text-sm text-warning">{errors.amends_entry_id}</p>}
        </div>
      )}

      {fields.map((field) => (
        <FieldInput
          key={field.key}
          id={`${idPrefix}-${field.key}`}
          field={field}
          units={units}
          // Only new entries enforce "required" in the browser. Follow-ups and
          // corrections of follow-ups don't need every field.
          required={mode === "new" && Boolean(field.required)}
          defaultValue={defaults[field.key] ?? ""}
          error={errors[field.key]}
          outOfRange={outKeys.has(field.key)}
          limit={limitText(field, allValues)}
        />
      ))}

      {showAction && (
        <div className="rounded-xl border border-warning/40 bg-warning-light p-3">
          <label htmlFor={`${idPrefix}-action`} className="block text-sm font-semibold text-warning">
            Out of range: what did you do about it?
          </label>
          <textarea
            id={`${idPrefix}-action`}
            name="corrective_action"
            required
            rows={2}
            maxLength={500}
            defaultValue={defaults.corrective_action ?? ""}
            placeholder="e.g. Moved food to fridge 2, called the technician"
            className={`${inputClass} mt-1.5 py-2 ${errors.corrective_action ? "border-warning" : "border-line"}`}
          />
          {errors.corrective_action && <p className="mt-1 text-sm text-warning">{errors.corrective_action}</p>}
        </div>
      )}

      {mode === "correction" && (
        <div>
          <label htmlFor={`${idPrefix}-note`} className="block text-sm font-semibold text-ink">
            What was wrong with the original?
          </label>
          <textarea
            id={`${idPrefix}-note`}
            name="note"
            required
            rows={2}
            maxLength={500}
            defaultValue={defaults.note ?? ""}
            className={`${inputClass} mt-1.5 py-2 ${errors.note ? "border-warning" : "border-line"}`}
          />
          {errors.note && <p className="mt-1 text-sm text-warning">{errors.note}</p>}
        </div>
      )}

      {state.message && (
        <p
          role={state.ok ? "status" : "alert"}
          className={
            state.ok
              ? "rounded-xl bg-primary-light px-3 py-2 text-sm font-medium text-primary-dark"
              : "rounded-xl bg-warning-light px-3 py-2 text-sm font-medium text-warning"
          }
        >
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="min-h-[50px] w-full rounded-xl bg-primary px-4 text-base font-semibold text-white hover:bg-primary-dark disabled:cursor-wait disabled:opacity-70"
      >
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}

function FieldInput({
  id,
  field,
  units,
  required,
  defaultValue,
  error,
  outOfRange,
  limit,
}: {
  id: string;
  field: RecordField;
  units: { id: string; name: string }[];
  required: boolean;
  defaultValue: string;
  error?: string;
  outOfRange: boolean;
  limit: string;
}) {
  const hintId = `${id}-hint`;
  const border = error || outOfRange ? "border-warning" : "border-line";
  const common = {
    id,
    name: field.key,
    required,
    defaultValue,
    "aria-invalid": Boolean(error),
    "aria-describedby": hintId,
  };

  let control;
  switch (field.type) {
    case "number":
      // type="text" + inputMode="decimal": a number keypad on phones, and it
      // accepts "4,5" (number inputs reject commas in some locales).
      control = <input {...common} type="text" inputMode="decimal" autoComplete="off" className={`${inputClass} ${border}`} />;
      break;
    case "time":
      control = <input {...common} type="time" className={`${inputClass} ${border}`} />;
      break;
    case "date":
      control = <input {...common} type="date" className={`${inputClass} ${border}`} />;
      break;
    case "select":
      control = (
        <select {...common} className={`${inputClass} ${border}`}>
          <option value="">Choose…</option>
          {field.options?.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
      break;
    case "temp_unit":
      control =
        units.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line bg-white p-3 text-sm text-muted">
            No fridges or units are set up for this site yet.
          </p>
        ) : (
          <select {...common} className={`${inputClass} ${border}`}>
            <option value="">Choose…</option>
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </select>
        );
      break;
    case "yes_no":
      // Two big radio "buttons". A fieldset groups them for screen readers.
      return (
        <fieldset aria-describedby={hintId}>
          <legend className="text-sm font-semibold text-ink">
            {field.label}
            {!required && <span className="font-normal text-muted"> (optional)</span>}
          </legend>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            {(["yes", "no"] as const).map((choice) => (
              <label
                key={choice}
                className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-line bg-white font-medium has-checked:border-primary has-checked:bg-primary-light has-checked:text-primary-dark"
              >
                <input
                  type="radio"
                  name={field.key}
                  value={choice}
                  required={required}
                  defaultChecked={defaultValue === choice}
                  className="h-5 w-5 accent-primary"
                />
                {choice === "yes" ? "Yes" : "No"}
              </label>
            ))}
          </div>
          <Hint id={hintId} error={error} />
        </fieldset>
      );
    default:
      control = <input {...common} type="text" maxLength={500} autoComplete="off" className={`${inputClass} ${border}`} />;
  }

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-ink">
        {field.label}
        {!required && <span className="font-normal text-muted"> (optional)</span>}
      </label>
      {limit && <p className="text-[13px] text-muted">Must be {limit}</p>}
      <div className="mt-1.5">{control}</div>
      <Hint id={hintId} error={error} outOfRange={outOfRange} limit={limit} />
    </div>
  );
}

function Hint({ id, error, outOfRange, limit }: { id: string; error?: string; outOfRange?: boolean; limit?: string }) {
  if (error) {
    return (
      <p id={id} className="mt-1 text-sm text-warning">
        {error}
      </p>
    );
  }
  if (outOfRange) {
    return (
      <p id={id} className="mt-1 text-sm font-medium text-warning">
        <span aria-hidden="true">⚠ </span>Out of range: must be {limit}
      </p>
    );
  }
  return <span id={id} hidden />;
}
