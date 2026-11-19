// Shows one record: the original entry, any later readings under it, and
// corrections attached to the entry they correct. Server Component.

import type { ReactNode } from "react";
import { aucklandTime } from "@/lib/dates";
import {
  findOutOfRange,
  formatValue,
  type EntryGroup,
  type EntryLike,
  type EntryNode,
  type EntryValues,
  type RecordField,
} from "@/lib/records";

export type EntryRow = EntryLike & {
  out_of_range: boolean;
  corrective_action: string | null;
  note: string | null;
  recorder: { name: string } | null;
};

type Shared = { fields: RecordField[]; unitNames: Record<string, string> };

export function EntryGroupCard({
  group,
  fields,
  unitNames,
  children,
}: Shared & { group: EntryGroup<EntryRow>; children?: ReactNode }) {
  const rootValues = group.root.entry.values;
  return (
    <li className="rounded-[14px] border border-line bg-white p-3.5">
      <EntryBlock node={group.root} fields={fields} unitNames={unitNames} />
      {group.followUps.map((node) => (
        <div key={node.entry.id} className="mt-3 border-t border-line pt-3">
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">Later reading</p>
          <EntryBlock node={node} fields={fields} unitNames={unitNames} base={rootValues} />
        </div>
      ))}
      {children}
    </li>
  );
}

function Meta({ entry }: { entry: EntryRow }) {
  return (
    <p className="text-[13px] text-muted">
      {aucklandTime(entry.recorded_at)} by {entry.recorder?.name ?? "a team member"}
    </p>
  );
}

function Values({
  entry,
  fields,
  unitNames,
  base = {},
}: Shared & { entry: EntryRow; base?: EntryValues }) {
  const outKeys = new Set(findOutOfRange(fields, { ...base, ...entry.values }));
  const shown = fields.filter((f) => entry.values[f.key] !== undefined && entry.values[f.key] !== null);
  return (
    <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[15px]">
      {shown.map((field) => {
        const out = outKeys.has(field.key);
        return (
          <div key={field.key} className="contents">
            <dt className="text-muted">{field.label}</dt>
            <dd className={out ? "font-semibold text-warning" : "font-medium text-ink"}>
              {formatValue(field, entry.values[field.key], unitNames)}
              {out && <span className="sr-only"> (out of range)</span>}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function OutOfRange({ entry }: { entry: EntryRow }) {
  if (!entry.out_of_range) return null;
  return (
    <div className="mt-2 rounded-xl border border-warning/40 bg-warning-light px-3 py-2 text-sm">
      <p className="font-semibold text-warning">
        <span aria-hidden="true">⚠ </span>Out of range
      </p>
      {entry.corrective_action && <p className="mt-0.5 text-ink">Action: {entry.corrective_action}</p>}
    </div>
  );
}

/** The optional "Comments" box (the note column). Required on corrections. */
function Comments({ entry }: { entry: EntryRow }) {
  if (!entry.note) return null;
  return (
    <p className="mt-2 text-sm text-ink">
      <span className="font-semibold">Comments:</span> {entry.note}
    </p>
  );
}

function EntryBlock({
  node,
  fields,
  unitNames,
  base,
}: Shared & { node: EntryNode<EntryRow>; base?: EntryValues }) {
  const corrected = node.corrections.length > 0;
  return (
    <div>
      {/* No fading for corrected entries: it would push the text below AA
          contrast. The "Corrected below" label says it instead. */}
      <div>
        <Meta entry={node.entry} />
        <Values entry={node.entry} fields={fields} unitNames={unitNames} base={base} />
        <OutOfRange entry={node.entry} />
        <Comments entry={node.entry} />
        {corrected && <p className="mt-1 text-xs font-semibold text-muted">Corrected below</p>}
      </div>
      {node.corrections.map((correction) => (
        <div key={correction.id} className="mt-2.5 border-l-4 border-primary/40 pl-3">
          <p className="text-xs font-semibold tracking-wide text-primary-dark uppercase">Correction</p>
          <Meta entry={correction} />
          <Values entry={correction} fields={fields} unitNames={unitNames} base={base} />
          <OutOfRange entry={correction} />
          <Comments entry={correction} />
        </div>
      ))}
    </div>
  );
}
